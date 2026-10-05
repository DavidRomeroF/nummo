// Primitivas criptográficas sobre WebCrypto (nativo del navegador; sin librerías externas).
// - Derivación de claves: PBKDF2-HMAC-SHA-256 (600.000 iteraciones, recomendación OWASP 2023).
// - Cifrado autenticado: AES-256-GCM con IV aleatorio de 96 bits por operación y datos asociados
//   (AAD) que atan cada texto cifrado a su uso, para que no se pueda mover de un sitio a otro.

export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 5_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function isCryptoAvailable() {
  return typeof crypto !== 'undefined' && !!crypto.subtle && globalThis.isSecureContext !== false;
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Clave AES-GCM derivada de un PIN o contraseña. No extraíble. */
export async function deriveKey(secret, salt, iterations = DEFAULT_ITERATIONS) {
  if (!Number.isSafeInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new RangeError('Número de iteraciones fuera de rango');
  }
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Importa 32 bytes aleatorios como clave AES-GCM no extraíble. */
export function importAesKey(raw) {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes, aad) {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, bytes);
  return { iv, ct: new Uint8Array(ct) };
}

/** Lanza una excepción si la clave no es la correcta o los datos se han manipulado. */
export async function decryptBytes(key, { iv, ct }, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, key, ct);
  return new Uint8Array(pt);
}

export function encryptJSON(key, value, aad) {
  return encryptBytes(key, encoder.encode(JSON.stringify(value)), aad);
}

export async function decryptJSON(key, box, aad) {
  return JSON.parse(decoder.decode(await decryptBytes(key, box, aad)));
}

// --- Base64 (para el archivo de copia de seguridad) ---------------------------------------------

const CHUNK = 0x8000;

export function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    throw new TypeError('Base64 no válido');
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
