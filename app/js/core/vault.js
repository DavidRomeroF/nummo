// Caja fuerte cifrada: guarda los bloques de datos cifrados con una clave maestra aleatoria (DEK).
// La DEK solo se guarda cifrada con una clave derivada del PIN (KEK). Si el PIN es incorrecto,
// AES-GCM no puede descifrar la DEK: no hace falta guardar ningún "hash" del PIN.
// Mientras la app está desbloqueada la DEK vive solo en memoria y no es extraíble.
// Cada escritura comprueba una marca de revisión: si otra pestaña o ventana de la app escribió
// después de que esta cargara los datos, se rechaza (ConflictError) en vez de pisarlos.

import * as idb from './idb.js';
import { newId } from './ids.js';
import {
  DEFAULT_ITERATIONS, SALT_BYTES, randomBytes, deriveKey, importAesKey,
  encryptBytes, decryptBytes, encryptJSON, decryptJSON,
} from './crypto.js';
import { isBucketKey } from './model.js';

const META_KEY = 'vault';
const LOCKOUT_KEY = 'lockout';
const REVISION_KEY = 'revision';
export { ConflictError } from './idb.js';
const DEK_AAD = 'app-dinero:dek:v1';
const bucketAad = (key) => `app-dinero:bucket:v1:${key}`;

export const PIN_LENGTH = 6;
export const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

export class WrongPinError extends Error {
  constructor(lockedUntil, failures) {
    super('PIN incorrecto');
    this.name = 'WrongPinError';
    this.lockedUntil = lockedUntil; // 0 si aún quedan intentos libres
    this.failures = failures; // fallos seguidos, incluido este
  }
}

export class LockedOutError extends Error {
  constructor(until) {
    super('Demasiados intentos');
    this.name = 'LockedOutError';
    this.until = until;
  }
}

let dek = null;
let revision; // marca de la última escritura que conoce esta instancia
let kdfIterations = DEFAULT_ITERATIONS;

/** Solo para tests: menos iteraciones para que la batería de pruebas sea rápida. */
export function setIterationsForTests(n) {
  kdfIterations = n;
}

export const isValidPin = (pin) => typeof pin === 'string' && new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

const SEQUENCES = '01234567890 98765432109';
/** PIN demasiado fácil: todos iguales (111111) o consecutivos (123456, 654321). */
export const isWeakPin = (pin) => /^(\d)\1+$/.test(pin) || SEQUENCES.includes(pin);
export const isUnlocked = () => dek !== null;

/** 'new' si no hay datos todavía; 'locked' si hay una caja fuerte creada. */
export async function status() {
  return (await idb.get('meta', META_KEY)) ? 'locked' : 'new';
}

export function delayAfter(failures) {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_DELAY_MS);
}

export async function getLockout() {
  const value = await idb.get('meta', LOCKOUT_KEY);
  return {
    failures: Number.isSafeInteger(value?.failures) ? value.failures : 0,
    until: Number.isSafeInteger(value?.until) ? value.until : 0,
  };
}

async function wrapDek(pin, dekRaw) {
  const salt = randomBytes(SALT_BYTES);
  const kek = await deriveKey(pin, salt, kdfIterations);
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdfIterations, salt },
    dek: await encryptBytes(kek, dekRaw, DEK_AAD),
  };
}

/** Descifra la DEK con el PIN aplicando el límite de intentos. Devuelve los 32 bytes en claro. */
async function openDek(pin) {
  const meta = await idb.get('meta', META_KEY);
  if (!meta) throw new Error('No hay datos que desbloquear');
  const lockout = await getLockout();
  if (lockout.until > Date.now()) throw new LockedOutError(lockout.until);
  const kek = await deriveKey(pin, meta.kdf.salt, meta.kdf.iterations);
  let raw;
  try {
    raw = await decryptBytes(kek, meta.dek, DEK_AAD);
  } catch {
    // Lectura y escritura en una sola transacción: varios intentos a la vez cuentan todos.
    let failures = 0;
    let until = 0;
    await idb.update('meta', LOCKOUT_KEY, (value) => {
      failures = (Number.isSafeInteger(value?.failures) ? value.failures : 0) + 1;
      const delay = delayAfter(failures);
      until = delay ? Date.now() + delay : 0;
      return { failures, until };
    });
    throw new WrongPinError(until, failures);
  }
  if (lockout.failures > 0) await idb.put('meta', LOCKOUT_KEY, { failures: 0, until: 0 });
  return raw;
}

async function encryptBuckets(key, buckets) {
  return Promise.all([...buckets].map(async ([name, value]) => {
    if (!isBucketKey(name)) throw new Error(`Bloque no válido: ${name}`);
    return [name, await encryptJSON(key, value, bucketAad(name))];
  }));
}

/** Crea la caja fuerte (sustituye cualquier dato anterior) y la deja desbloqueada. */
export async function create(pin, buckets) {
  if (!isValidPin(pin)) throw new Error('PIN no válido');
  const dekRaw = randomBytes(32);
  try {
    const meta = await wrapDek(pin, dekRaw);
    const key = await importAesKey(dekRaw);
    const vault = await encryptBuckets(key, buckets);
    const token = newId();
    await idb.replaceAll({ meta: [[META_KEY, meta], [REVISION_KEY, token]], vault });
    dek = key;
    revision = token;
  } finally {
    dekRaw.fill(0);
  }
}

/** Desbloquea con el PIN y devuelve los bloques descifrados (Map nombre → objeto). */
export async function unlock(pin) {
  const dekRaw = await openDek(pin);
  let key;
  try {
    key = await importAesKey(dekRaw);
  } finally {
    dekRaw.fill(0);
  }
  const [stored, current] = await Promise.all([idb.entries('vault'), idb.get('meta', REVISION_KEY)]);
  const decrypted = await Promise.all(stored.map(async ([name, box]) => [name, await decryptJSON(key, box, bucketAad(name))]));
  dek = key;
  revision = current;
  return new Map(decrypted);
}

export function lock() {
  dek = null;
  revision = undefined;
}

/** Cifra y guarda bloques; los bloques con valor null se borran. Todo en una transacción. */
export async function saveBuckets(changes) {
  if (!dek) throw new Error('La caja fuerte está bloqueada');
  const puts = [...changes].filter(([, value]) => value !== null);
  const deletes = [...changes].filter(([, value]) => value === null).map(([name]) => name);
  const next = newId();
  await idb.writeChecked({ expected: revision, next, puts: await encryptBuckets(dek, puts), deletes });
  revision = next;
}

/** Sustituye todos los datos (restaurar copia) manteniendo el PIN y la clave actuales. */
export async function replaceBuckets(buckets) {
  if (!dek) throw new Error('La caja fuerte está bloqueada');
  const next = newId();
  await idb.writeChecked({ expected: revision, next, puts: await encryptBuckets(dek, buckets), clear: true });
  revision = next;
}

/** Comprueba un PIN (cuenta como intento a efectos del límite). */
export async function verifyPin(pin) {
  (await openDek(pin)).fill(0);
}

/** Comprueba el PIN actual y vuelve a cifrar la DEK con el nuevo (los datos no se recifran). */
export async function changePin(currentPin, newPin) {
  if (!isValidPin(newPin)) throw new Error('PIN no válido');
  const dekRaw = await openDek(currentPin);
  try {
    await idb.put('meta', META_KEY, await wrapDek(newPin, dekRaw));
  } finally {
    dekRaw.fill(0);
  }
}

/** Borra todos los datos de este dispositivo. */
export async function destroy() {
  await idb.clearAll(); // si falla, la sesión sigue igual (no queda a medias)
  dek = null;
  revision = undefined;
}
