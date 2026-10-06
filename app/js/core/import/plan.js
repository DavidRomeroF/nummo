// Plan de importación: decide, sin modificar nada, qué apuntes son nuevos, cuáles ya estaban
// (duplicados), qué pendientes pasan a contabilizados y qué transferencias entre cuentas propias
// hay que unir. store.applyImport() aplica el plan de una vez (todo o nada).
//
// Idempotencia: importar los mismos apuntes otra vez produce un plan vacío. Se reconoce un apunte
// ya importado, por este orden, por:
//   1. el identificador del banco (o número de apunte del extracto) en la misma cuenta;
//   2. la huella (fecha contable + importe + concepto + nº de aparición);
//   3. un pendiente del mismo importe a ≤ 5 días (el banco lo ha contabilizado);
//   4. un apunte de la otra fuente (archivo ↔ banco) con la misma fecha contable e importe;
//   5. un movimiento apuntado a mano en esa cuenta, mismo importe a ≤ 3 días (se le añade el origen).

import { diffDays } from '../dates.js';
import { categorize, sortRules } from './rules.js';

const PENDING_MATCH_DAYS = 5;
const MANUAL_MATCH_DAYS = 3;
const TRANSFER_MATCH_DAYS = 3;

/** Lados de un movimiento que tocan una cuenta, con su importe con signo para esa cuenta. */
function legsOf(m, debtKinds) {
  switch (m.type) {
    case 'expense': return [{ slot: 'source', accountId: m.accountId, signed: -m.amount }];
    case 'income': return [{ slot: 'source', accountId: m.accountId, signed: m.amount }];
    case 'transfer': return [
      { slot: 'source', accountId: m.accountId, signed: -m.amount },
      { slot: 'source2', accountId: m.toAccountId, signed: m.amount },
    ];
    case 'debt': {
      if (!m.accountId) return [];
      const sign = (debtKinds.get(m.debtId) === 'owe') === (m.flow === 'add') ? 1 : -1;
      return [{ slot: 'source', accountId: m.accountId, signed: sign * m.amount }];
    }
    default: return [];
  }
}

const near = (a, b, days) => Math.abs(diffDays(a, b)) <= days;

function sourceOf(item, kind, batch, cat) {
  return {
    kind, ext: item.ext, fp: item.fp, bdate: item.bdate, vdate: item.vdate, status: item.status,
    text: item.text, cp: item.cp, cpIban: item.cpIban, bal: item.bal, mcc: item.mcc, cat, batch,
  };
}

/** Actualiza el origen guardado con los datos nuevos del banco sin perder la categoría elegida. */
function refreshSource(old, item, kind) {
  return {
    ...old,
    kind: old.kind ?? kind,
    ext: old.ext || item.ext,
    fp: old.kind === kind || !old.fp ? item.fp : old.fp,
    bdate: item.bdate,
    vdate: item.vdate ?? old.vdate,
    status: item.status,
    bal: item.bal ?? old.bal,
    mcc: old.mcc || item.mcc,
    cpIban: old.cpIban || item.cpIban,
  };
}

/**
 * state: estado actual. items: apuntes preparados (prepareItems) de UNA cuenta.
 * opts: { accountId, kind: 'bank'|'file', batch, newId(), now, replacePendingFrom? }
 *   - replacePendingFrom: 'AAAA-MM-DD'. Solo banco: los pendientes de esa cuenta desde esa fecha
 *     que ya no aparecen se quitan (el banco los ha anulado o contabilizado con otro importe).
 * Devuelve { add, update, remove, stats, balance }:
 *   - add: movimientos nuevos; update: [{ before, after }]; remove: movimientos a quitar;
 *   - balance: { amount, date } saldo más reciente que trae el archivo (si lo trae).
 */
export function planImport(state, items, opts) {
  const { accountId, kind, batch, newId, now } = opts;
  const debtKinds = new Map(state.debts.map((d) => [d.id, d.kind]));
  const rules = sortRules(state.rules ?? []);
  const ownIbans = new Map((state.accounts ?? []).filter((a) => a.bank?.ibanHash).map((a) => [a.bank.ibanHash, a.id]));
  const thisAccount = state.accounts.find((a) => a.id === accountId);
  const ctx = { accountId, categories: state.categories, accounts: state.accounts, rules };

  // Índices de lo que ya hay en esta cuenta.
  const byExt = new Map();
  const byFp = new Map();
  const legs = [];
  for (const m of state.movements) {
    for (const leg of legsOf(m, debtKinds)) {
      if (leg.accountId !== accountId) continue;
      const entry = { m, ...leg, src: m[leg.slot] ?? null };
      legs.push(entry);
      if (entry.src?.ext) byExt.set(entry.src.ext, entry);
      if (entry.src?.fp && entry.src.kind === kind) byFp.set(entry.src.fp, entry);
    }
  }

  const consumed = new Set(); // lados ya emparejados en esta importación
  const updates = new Map(); // id → { before, after }
  const current = (m) => updates.get(m.id)?.after ?? m;
  const setLeg = (entry, source) => {
    const base = current(entry.m);
    const before = updates.get(entry.m.id)?.before ?? entry.m;
    updates.set(entry.m.id, { before, after: { ...base, [entry.slot]: source } });
  };
  const free = (entry) => !consumed.has(entry);
  const stats = { added: 0, duplicates: 0, confirmed: 0, linked: 0, transfers: 0, removedPending: 0, pending: 0 };
  const add = [];
  const pendingSeen = new Set();

  for (const item of items) {
    let match = null;
    let how = 'duplicate';
    if (item.ext && byExt.has(item.ext) && free(byExt.get(item.ext))) match = byExt.get(item.ext);
    if (!match && byFp.has(item.fp) && free(byFp.get(item.fp))) match = byFp.get(item.fp);
    if (!match && item.status === 'booked') {
      match = legs.find((e) => free(e) && e.src?.status === 'pending' && e.signed === item.amount
        && near(e.src.bdate, item.bdate, PENDING_MATCH_DAYS)) ?? null;
      if (match) how = 'confirmed';
    }
    if (!match) {
      match = legs.find((e) => free(e) && e.src && e.src.kind !== kind && e.signed === item.amount
        && e.src.bdate === item.bdate) ?? null;
    }
    if (!match) {
      match = legs.find((e) => free(e) && !e.src && e.signed === item.amount
        && near(e.m.date, item.date, MANUAL_MATCH_DAYS)) ?? null;
      if (match) how = 'linked';
    }

    if (match) {
      consumed.add(match);
      if (match.src?.status === 'pending' || item.status === 'pending') pendingSeen.add(match.m.id);
      if (how === 'linked') {
        setLeg(match, sourceOf(item, kind, batch, 'user'));
        stats.linked += 1;
      } else {
        const refreshed = refreshSource(match.src, item, kind);
        if (JSON.stringify(refreshed) !== JSON.stringify(match.src)) setLeg(match, refreshed);
        if (how === 'confirmed') stats.confirmed += 1;
        else stats.duplicates += 1;
      }
      continue;
    }

    // Apunte nuevo.
    const decision = categorize(item, ctx);
    const base = { id: newId(), date: item.date, amount: Math.abs(item.amount), note: item.text, ts: now };
    let movement;
    if (decision.type === 'transfer') {
      movement = item.amount < 0
        ? { ...base, type: 'transfer', accountId, toAccountId: decision.otherAccountId, source: sourceOf(item, kind, batch, decision.cat) }
        : { ...base, type: 'transfer', accountId: decision.otherAccountId, toAccountId: accountId, source2: sourceOf(item, kind, batch, decision.cat) };
    } else {
      if (!decision.categoryId) continue; // sin categorías de ese tipo: no se puede guardar
      movement = { ...base, type: decision.type, accountId, categoryId: decision.categoryId, source: sourceOf(item, kind, batch, decision.cat) };
    }
    if (item.status === 'pending') {
      stats.pending += 1;
      pendingSeen.add(movement.id);
    }
    // ¿Es la otra mitad de una transferencia entre cuentas propias? (IBAN de la contrapartida)
    if (movement.type !== 'transfer') {
      const pair = findOwnTransferPair(state, current, consumed, { item, accountId, thisAccount, ownIbans, debtKinds });
      if (pair) {
        consumed.add(pair);
        const other = current(pair.m);
        const before = updates.get(pair.m.id)?.before ?? pair.m;
        const mine = sourceOf(item, kind, batch, 'auto');
        const after = item.amount < 0
          ? { id: other.id, date: item.date, type: 'transfer', amount: other.amount, accountId, toAccountId: pair.accountId, note: other.note || item.text, ts: other.ts, source: mine, source2: other.source }
          : { id: other.id, date: other.date, type: 'transfer', amount: other.amount, accountId: pair.accountId, toAccountId: accountId, note: other.note || item.text, ts: other.ts, source: other.source, source2: mine };
        if (other.recurringId) after.recurringId = other.recurringId;
        updates.set(other.id, { before, after });
        stats.transfers += 1;
        continue;
      }
    }
    add.push(movement);
    stats.added += 1;
  }

  // Pendientes que el banco ya no devuelve: se quitan (solo al sincronizar con el banco).
  const remove = [];
  if (kind === 'bank' && opts.replacePendingFrom) {
    for (const e of legs) {
      if (consumed.has(e) || e.src?.status !== 'pending' || e.src.kind !== 'bank') continue;
      if (e.src.bdate < opts.replacePendingFrom || pendingSeen.has(e.m.id)) continue;
      if (e.m.type === 'transfer' && e.m.source && e.m.source2) continue; // la otra mitad sigue siendo real
      remove.push(e.m);
      stats.removedPending += 1;
    }
  }

  // Saldo más reciente que trae el extracto (el del último apunte contabilizado).
  let balance = null;
  for (const item of items) {
    if (item.bal === null || item.status !== 'booked') continue;
    if (!balance || item.bdate > balance.date
      || (item.bdate === balance.date && Number(item.ext.replace(/\D/g, '') || 0) > balance.order)) {
      balance = { amount: item.bal, date: item.bdate, order: Number(item.ext.replace(/\D/g, '') || 0) };
    }
  }
  if (balance) delete balance.order;

  return { add, update: [...updates.values()].filter((u) => !remove.includes(u.before)), remove, stats, balance };
}

/**
 * Busca en OTRA cuenta propia la mitad contraria de una transferencia: mismo importe y signo
 * contrario, a ≤ 3 días, sin emparejar, y con prueba de que va entre cuentas propias (el IBAN de la
 * contrapartida es el de la otra cuenta, o el de la otra mitad es el de esta cuenta).
 */
function findOwnTransferPair(state, current, consumed, { item, accountId, thisAccount, ownIbans, debtKinds }) {
  const myHash = thisAccount?.bank?.ibanHash ?? '';
  for (const m of state.movements) {
    const cur = current(m);
    if (cur.type !== 'expense' && cur.type !== 'income') continue;
    if (cur.accountId === accountId || !cur.source) continue;
    const [leg] = legsOf(cur, debtKinds);
    if (leg.signed !== -item.amount || !near(cur.date, item.date, TRANSFER_MATCH_DAYS)) continue;
    const viaMine = item.cpIban && ownIbans.get(item.cpIban) === cur.accountId;
    const viaTheirs = myHash && cur.source.cpIban === myHash;
    if (!viaMine && !viaTheirs) continue;
    const entry = { m, ...leg, src: cur.source };
    if ([...consumed].some((e) => e.m === m)) continue;
    return entry;
  }
  return null;
}

/**
 * Posibles transferencias entre cuentas propias que no se han podido unir solas: un gasto en una
 * cuenta y un ingreso del mismo importe en otra a ≤ 3 días, y al menos uno con concepto de
 * transferencia. Se proponen a la persona; nunca se unen sin confirmar.
 */
export function findTransferCandidates(state, { isTransferText, limit = 50 } = {}) {
  const out = [];
  const incomes = state.movements.filter((m) => m.type === 'income');
  const used = new Set();
  for (const e of state.movements) {
    if (e.type !== 'expense') continue;
    for (const i of incomes) {
      if (used.has(i.id) || i.accountId === e.accountId || i.amount !== e.amount) continue;
      if (!near(e.date, i.date, TRANSFER_MATCH_DAYS)) continue;
      const texts = `${e.source?.text ?? e.note} ${i.source?.text ?? i.note}`;
      if (isTransferText && !isTransferText(texts)) continue;
      out.push({ expenseId: e.id, incomeId: i.id });
      used.add(i.id);
      break;
    }
    if (out.length >= limit) break;
  }
  return out;
}
