// Operaciones de banca abierta para la interfaz: configurar la aplicación de Enable Banking,
// conectar un banco (redirección y vuelta), vincular cuentas, sincronizar y desconectar.
// Los secretos (clave privada, sesiones, conexión a medias) viven en el bloque cifrado 'secrets'
// del almacén; nunca en `state`, en copias, en exportaciones ni en el registro.

import * as store from '../store.js';
import { newId } from '../ids.js';
import { ValidationError } from '../model.js';
import { BankError } from './provider.js';
import { createEnableBankingProvider, normalizeProxyUrl } from './enablebanking.js';
import { importPrivateKey, checkPem } from './jwt.js';
import { syncConnection, syncStatus, withSyncLock, bankFieldsFor } from './sync.js';

export const DEFAULT_COUNTRY = 'ES';
const MAX_CONSENT_DAYS = 180;
const PENDING_AUTH_MAX_MS = 30 * 60_000;
const APP_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Configuración (aplicación propia en Enable Banking) ---------------------------------------

/** { appId, proxyUrl } si la aplicación está configurada (nunca devuelve la clave). */
export function getConfig() {
  const eb = store.getSecrets()?.eb;
  return eb?.appId ? { appId: eb.appId, proxyUrl: eb.proxyUrl ?? null } : null;
}

/**
 * Valida y guarda el identificador, la clave privada (.pem) y el intermediario (Cloudflare Worker).
 * Al editar, la clave se puede dejar en blanco para conservar la guardada.
 */
export async function saveConfig({ appId, pem = '', proxyUrl = '' }) {
  const id = String(appId ?? '').trim();
  if (!APP_ID_RE.test(id)) throw new ValidationError('El identificador de la aplicación debe ser como 1a2b3c4d-1234-…');
  const secrets = store.getSecrets() ?? {};
  let cleanPem = secrets.eb?.pem ?? null;
  if (String(pem).trim() || !cleanPem) {
    cleanPem = checkPem(pem);
    await importPrivateKey(cleanPem); // comprueba que se puede usar para firmar
  }
  let proxy = null;
  if (String(proxyUrl).trim()) {
    proxy = normalizeProxyUrl(proxyUrl);
    if (!proxy) throw new ValidationError('El intermediario debe ser una dirección como https://nummo-banco.tu-usuario.workers.dev');
  }
  await store.setSecrets({ ...secrets, eb: { appId: id, pem: cleanPem, proxyUrl: proxy }, sessions: secrets.sessions ?? {} });
}

/** Comprueba que se puede hablar con Enable Banking (pide la lista de bancos). */
export async function testConnection() {
  const provider = await getProvider();
  const banks = await provider.listBanks(DEFAULT_COUNTRY);
  return banks.length;
}

/** Olvida la aplicación (solo si no queda ningún banco conectado). */
export async function forgetConfig() {
  if (store.getState().connections.length) throw new ValidationError('Primero desconecta tus bancos.');
  await store.setSecrets(null);
}

let providerOverride = null;
/** Solo para tests: sustituye el proveedor real (que haría peticiones de red). */
export function setProviderForTests(provider) {
  providerOverride = provider;
}

/** Proveedor listo para usar con la clave importada (no extraíble). */
export async function getProvider() {
  if (providerOverride) return providerOverride;
  const eb = store.getSecrets()?.eb;
  if (!eb?.appId || !eb.pem) throw new BankError('no_secrets');
  const privateKey = await importPrivateKey(eb.pem);
  return createEnableBankingProvider({ appId: eb.appId, privateKey, proxyUrl: eb.proxyUrl ?? null });
}

/** Dirección a la que vuelve el banco: la de la propia app (debe estar registrada en Enable Banking). */
export function redirectUrl() {
  return `${location.origin}${location.pathname}`;
}

// --- Conectar ------------------------------------------------------------------------------------

/**
 * Pide al proveedor la URL de autenticación del banco y guarda (cifrado) el estado para
 * reconocer la vuelta. reconnectId: conexión existente cuyo permiso se renueva.
 */
export async function beginConnect({ bankName, country = DEFAULT_COUNTRY, maxConsentDays = MAX_CONSENT_DAYS, reconnectId = null }) {
  const provider = await getProvider();
  const state = newId(32);
  const days = Math.max(1, Math.min(MAX_CONSENT_DAYS, maxConsentDays || MAX_CONSENT_DAYS));
  const validUntil = Date.now() + days * 86_400_000;
  const { url } = await provider.startAuth({ bankName, country, redirectUrl: redirectUrl(), state, validUntil });
  const secrets = store.getSecrets() ?? {};
  await store.setSecrets({ ...secrets, pending: { state, bankName, country, at: Date.now(), reconnectId } });
  await store.flush();
  return url;
}

// Vuelta del banco: main.js la recoge de la URL al arrancar (y la borra de la barra de direcciones).
let callback = null;
export function setCallback(value) {
  callback = value;
}
export function takeCallback() {
  const value = callback;
  callback = null;
  return value;
}

/**
 * Completa la conexión con el código que devuelve el banco.
 * Devuelve { connection, accounts: [BankAccount] } para que la persona elija qué cuentas vincular.
 */
export async function completeConnect({ code, state, error }) {
  const secrets = store.getSecrets() ?? {};
  const pending = secrets.pending;
  const clearPending = async () => {
    const { pending: _drop, ...rest } = store.getSecrets() ?? {};
    await store.setSecrets(Object.keys(rest).length ? rest : null);
  };
  if (!pending || typeof state !== 'string' || state !== pending.state || Date.now() - pending.at > PENDING_AUTH_MAX_MS) {
    if (pending) await clearPending();
    throw new BankError('state');
  }
  if (error || !code) {
    await clearPending();
    throw new BankError('denied');
  }
  const provider = await getProvider();
  const session = await provider.finishAuth(code);
  let connection;
  const existing = pending.reconnectId ? store.getState().connections.find((c) => c.id === pending.reconnectId) : null;
  if (existing) {
    connection = store.updateConnection(existing.id, { status: 'active', validUntil: session.validUntil, lastError: null });
  } else {
    connection = store.addConnection({ provider: provider.id, bankName: pending.bankName, country: pending.country, status: 'active', validUntil: session.validUntil });
  }
  const { pending: _done, ...rest } = store.getSecrets() ?? {};
  const oldSession = rest.sessions?.[connection.id];
  await store.setSecrets({ ...rest, sessions: { ...(rest.sessions ?? {}), [connection.id]: session.sessionId } });
  if (oldSession && oldSession !== session.sessionId) provider.revoke(oldSession).catch(() => {}); // el permiso anterior ya no hace falta
  return { connection, accounts: session.accounts };
}

/**
 * Vincula cuentas del banco con cuentas de Nummo.
 * choices: [{ bankAccount, accountId | null (crear nueva), name }]
 */
export async function linkAccounts(connectionId, choices) {
  for (const { bankAccount, accountId, name } of choices) {
    const fields = await bankFieldsFor(connectionId, bankAccount);
    let target = accountId;
    if (!target) {
      const type = bankAccount.product === 'savings' ? 'savings' : bankAccount.product === 'card' ? 'card' : 'bank';
      target = store.addAccount({ name: name || 'Cuenta del banco', type, icon: type === 'savings' ? 'pig-money' : type === 'card' ? 'credit-card' : 'building-bank', color: 'green', initial: 0 }).id;
    }
    store.setAccountBank(target, fields);
  }
}

// --- Sincronizar ---------------------------------------------------------------------------------

/** Sincroniza un banco (sin solaparse con otra sincronización). */
export async function syncNow(connectionId) {
  return withSyncLock(async () => {
    const provider = await getProvider();
    const sessionId = store.getSecrets()?.sessions?.[connectionId] ?? null;
    return syncConnection(connectionId, { store, provider, sessionId, newId });
  });
}

/** Al abrir la app: sincroniza los bancos a los que les toca. Nunca lanza; devuelve el resumen. */
export async function autoSync() {
  const state = store.getState();
  if (!state?.settings.autoSync || !getConfig()) return null;
  const due = state.connections.filter((c) => syncStatus(c).canAuto);
  const summary = { synced: 0, added: 0, errors: [] };
  for (const c of due) {
    try {
      const result = await syncNow(c.id);
      if (result?.skipped) continue;
      summary.synced += 1;
      summary.added += (result.stats.added ?? 0) + (result.stats.transfers ?? 0);
    } catch (error) {
      summary.errors.push({ bankName: c.bankName, code: error?.code ?? 'invalid' });
    }
    if (!store.isLoaded()) break; // se bloqueó mientras tanto
  }
  return summary;
}

// --- Desconectar ---------------------------------------------------------------------------------

/**
 * Antes de borrar todos los datos: retira en el banco los permisos de todas las conexiones
 * (lo que se pueda; sin red, caducarán solos). Devuelve cuántos se retiraron.
 */
export async function revokeAll() {
  const sessions = Object.values(store.getSecrets()?.sessions ?? {});
  if (!sessions.length) return 0;
  let provider;
  try {
    provider = await getProvider();
  } catch {
    return 0;
  }
  const results = await Promise.allSettled(sessions.map((id) => provider.revoke(id)));
  return results.filter((r) => r.status === 'fulfilled').length;
}

/** Lee una dirección de vuelta pegada a mano (cuando el banco abrió el navegador y no la app). */
export function parseReturnUrl(text) {
  try {
    const url = new URL(String(text).trim());
    const p = url.searchParams;
    if (!p.get('state') || !(p.get('code') || p.get('error'))) return null;
    return { code: p.get('code')?.slice(0, 2000) ?? null, state: p.get('state').slice(0, 200), error: p.get('error')?.slice(0, 100) ?? null };
  } catch {
    return null;
  }
}

/**
 * Quita un banco: revoca el permiso en el banco (si se puede), olvida la sesión y deja sus cuentas
 * como manuales. Con deleteMovements también borra los movimientos que vinieron del banco.
 * Devuelve { revoked } (false si el banco no respondió: el permiso caducará solo).
 */
export async function disconnect(connectionId, { deleteMovements = false } = {}) {
  const secrets = store.getSecrets() ?? {};
  const sessionId = secrets.sessions?.[connectionId];
  let revoked = !sessionId;
  if (sessionId) {
    try {
      await (await getProvider()).revoke(sessionId);
      revoked = true;
    } catch {
      revoked = false;
    }
  }
  const sessions = { ...(secrets.sessions ?? {}) };
  delete sessions[connectionId];
  await store.setSecrets({ ...secrets, sessions });
  store.removeConnection(connectionId, { deleteMovements });
  return { revoked };
}
