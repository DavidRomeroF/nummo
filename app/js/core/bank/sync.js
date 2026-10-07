// Sincronización de un banco conectado: comprobar el permiso → cuentas → saldos → movimientos
// nuevos → deduplicar, categorizar y unir transferencias (core/import/) → guardar de una vez →
// registrar el resultado. Repetirla no duplica nada: usa la misma tubería idempotente que los archivos.
//
// Límites reales de PSD2 que se respetan:
// - Sin la persona delante, los bancos permiten unas 4 consultas al día por cuenta. Nummo no puede
//   despertarse sola (es una web), así que sincroniza al abrirla, como mucho una vez cada 6 horas
//   y 4 veces en 24 horas, y siempre que la persona pulse «Sincronizar ahora» (con aviso si se pasa).
// - El historial disponible es limitado (a menudo 90 días): si el banco rechaza el periodo, se
//   reintenta con 60 y 30 días.
// - El permiso caduca (máx. habitual 180 días): entonces hay que volver a conectar el banco.

import { BankError } from './provider.js';
import { prepareItems, hashIban, maskIban } from '../import/normalize.js';
import { planImport } from '../import/plan.js';
import { addDays, todayISO } from '../dates.js';

export const AUTO_SYNC_EVERY_MS = 6 * 3_600_000;
export const MAX_SYNCS_PER_DAY = 4;
export const FIRST_SYNC_DAYS = 90;
export const RETRY_AFTER_FAILURE_MS = 3_600_000;
const FALLBACK_DAYS = [60, 30];
const OVERLAP_DAYS = 10; // se vuelve a pedir un margen: el banco puede contabilizar con retraso
const DAY_MS = 86_400_000;

/** Intentos de las últimas 24 horas y si toca sincronizar sola o se puede a mano. */
export function syncStatus(connection, now = Date.now()) {
  const recent = connection.syncLog.filter((e) => now - e.at < DAY_MS);
  const rateLimited = connection.lastError?.code === 'rate_limit' && now - connection.lastError.at < AUTO_SYNC_EVERY_MS;
  const expired = connection.validUntil !== null && connection.validUntil <= now;
  const usable = connection.status === 'active' && !expired;
  const dueBySlot = !connection.lastSyncAt || now - connection.lastSyncAt >= AUTO_SYNC_EVERY_MS;
  const last = connection.syncLog.at(-1);
  const lastAttempt = last?.at ?? 0;
  // Tras un fallo se espera 1 h antes de reintentar sola (un fallo persistente no gasta las 4 consultas).
  const retryGap = last && !last.ok ? RETRY_AFTER_FAILURE_MS : 60_000;
  return {
    attemptsToday: recent.length,
    expired,
    usable,
    canAuto: usable && !rateLimited && dueBySlot && recent.length < MAX_SYNCS_PER_DAY && now - lastAttempt >= retryGap,
    overLimit: recent.length >= MAX_SYNCS_PER_DAY || rateLimited,
    expiresInDays: connection.validUntil ? Math.floor((connection.validUntil - now) / DAY_MS) : null,
  };
}

/** Fecha desde la que pedir movimientos a una cuenta: el último apunte del banco menos un margen. */
export function syncWindowStart(state, accountId, today) {
  let last = null;
  for (const m of state.movements) {
    for (const [slot, acc] of [['source', m.accountId], ['source2', m.toAccountId]]) {
      const src = m[slot];
      if (acc === accountId && src?.kind === 'bank' && src.status === 'booked' && (!last || src.bdate > last)) last = src.bdate;
    }
  }
  return last ? addDays(last, -OVERLAP_DAYS) : addDays(today, -FIRST_SYNC_DAYS);
}

/** Todas las páginas de movimientos de una cuenta desde una fecha. */
async function fetchAll(provider, externalId, dateFrom) {
  const items = [];
  let cursor = null;
  for (let page = 0; page < (provider.maxPages ?? 30); page += 1) {
    const result = await provider.getTransactions(externalId, { dateFrom, cursor });
    items.push(...result.items);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return items;
}

/** Igual que fetchAll, acortando el periodo si el banco no da tanto historial. */
async function fetchWithFallback(provider, externalId, dateFrom, today) {
  try {
    return { items: await fetchAll(provider, externalId, dateFrom), dateFrom };
  } catch (error) {
    if (!(error instanceof BankError) || error.code !== 'period') throw error;
  }
  for (const days of FALLBACK_DAYS) {
    const shorter = addDays(today, -days);
    if (shorter <= dateFrom) continue;
    try {
      return { items: await fetchAll(provider, externalId, shorter), dateFrom: shorter };
    } catch (error) {
      if (!(error instanceof BankError) || error.code !== 'period') throw error;
    }
  }
  throw new BankError('period');
}

const addStats = (total, s) => {
  for (const [k, v] of Object.entries(s)) total[k] = (total[k] ?? 0) + v;
  return total;
};

/**
 * Sincroniza un banco. deps: { store, provider, sessionId, newId, now?, today? }.
 * Devuelve { stats, newAccounts: [BankAccount sin vincular], accounts: n.º sincronizadas }.
 * Siempre registra el intento en la conexión (también si falla) y relanza los errores.
 */
export async function syncConnection(connectionId, { store, provider, sessionId, newId, now = Date.now(), today = todayISO() }) {
  // Si la app se bloquea durante la sincronización, lo descargado se descarta (no se aplica a
  // otra sesión aunque se vuelva a desbloquear antes de que termine).
  const generation = store.sessionGeneration?.() ?? 0;
  const stillHere = () => store.isLoaded() && (store.sessionGeneration?.() ?? 0) === generation;
  const record = (patch) => {
    if (!stillHere()) return;
    const current = store.getState()?.connections.find((c) => c.id === connectionId);
    if (!current) return; // se quitó el banco o se bloqueó la app mientras tanto
    store.updateConnection(connectionId, { ...patch, syncLog: [...current.syncLog, { at: now, ok: !patch.lastError, code: patch.lastError?.code ?? '' }] });
  };
  try {
    if (!sessionId) throw new BankError('expired', { detail: 'NO_SESSION_STORED' });
    const session = await provider.getSession(sessionId);
    if (session.status === 'expired' || session.status === 'revoked') throw new BankError(session.status, { detail: `STATUS_${session.rawStatus ?? ''}` });
    if (session.status === 'pending') throw new BankError('expired', { detail: `STATUS_${session.rawStatus ?? 'PENDING'}` });
    // Un estado desconocido no se da por caducado: se intenta leer y, si el banco rechaza, su error lo dirá.

    const state = store.getState();
    const linked = state.accounts.filter((a) => a.bank?.connectionId === connectionId && a.bank.externalId);
    const allowed = new Set(session.accountIds);
    const targets = linked.filter((a) => !allowed.size || allowed.has(a.bank.externalId));
    const linkedIds = new Set(linked.map((a) => a.bank.externalId));
    const newAccounts = session.accountIds.filter((id) => !linkedIds.has(id));

    const stats = {};
    for (const account of targets) {
      const extId = account.bank.externalId;
      const balances = await provider.getBalances(extId);
      const start = syncWindowStart(store.getState(), account.id, today);
      const { items: raws, dateFrom } = await fetchWithFallback(provider, extId, start, today);
      const { items } = await prepareItems(raws);
      if (!stillHere()) throw new BankError('invalid', { detail: 'LOCKED' });
      const batch = newId();
      const plan = planImport(store.getState(), items, { accountId: account.id, kind: 'bank', batch, newId, now, replacePendingFrom: dateFrom });
      const bank = { bankBalance: balances.booked, availableBalance: balances.available, balanceAt: balances.date ?? today };
      const balance = balances.booked !== null ? { amount: balances.booked, date: balances.date ?? today } : null;
      const result = store.applyImport(plan, { accountId: account.id, batch, bank, balance, excludePending: true });
      addStats(stats, result.stats);
    }
    record({ status: 'active', lastSyncAt: now, lastError: null, ...(session.validUntil ? { validUntil: session.validUntil } : {}) });
    return { stats, newAccounts, accounts: targets.length };
  } catch (error) {
    const code = error instanceof BankError ? error.code : 'invalid';
    const status = code === 'expired' || code === 'revoked' ? code : code === 'app_auth' ? 'error' : undefined;
    // El código técnico (p. ej. EXPIRED_SESSION) se guarda para poder diagnosticar; nunca lleva datos personales.
    record({ lastError: { code, at: now, detail: error instanceof BankError ? error.detail : '' }, ...(status ? { status } : {}) });
    throw error instanceof BankError ? error : new BankError('invalid');
  }
}

/** Datos de banco que se guardan en una cuenta vinculada (sin el IBAN completo). */
export async function bankFieldsFor(connectionId, bankAccount) {
  return {
    connectionId,
    externalId: bankAccount.externalId,
    ibanMasked: maskIban(bankAccount.iban),
    ibanHash: await hashIban(bankAccount.iban),
    currency: bankAccount.currency,
    product: bankAccount.product,
  };
}

/** Ejecuta `fn` sin solaparse con otra sincronización (también entre pestañas, si se puede). */
let localBusy = false;
export async function withSyncLock(fn) {
  if (globalThis.navigator?.locks?.request) {
    return navigator.locks.request('nummo-bank-sync', { ifAvailable: true }, async (lock) => {
      if (!lock) return { skipped: true };
      return fn();
    });
  }
  if (localBusy) return { skipped: true };
  localBusy = true;
  try {
    return await fn();
  } finally {
    localBusy = false;
  }
}
