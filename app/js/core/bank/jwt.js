// Firma de los JWT que identifican la aplicación de Open Banking de la persona (RS256).
// La clave privada se importa a WebCrypto como NO extraíble: el código de la app puede firmar con
// ella, pero no leerla. El texto PEM solo se guarda cifrado en el bloque de secretos de la caja fuerte.

const encoder = new TextEncoder();
const PEM_RE = /-----BEGIN (RSA )?PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END (RSA )?PRIVATE KEY-----/;
export const MAX_PEM_LENGTH = 16_384;

export class KeyFormatError extends Error {
  constructor(message = 'La clave privada no es válida. Debe ser el archivo .pem que te dio Enable Banking.') {
    super(message);
    this.name = 'KeyFormatError';
  }
}

function base64ToBytes(b64) {
  const clean = b64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw new KeyFormatError();
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const jsonPart = (value) => base64Url(encoder.encode(JSON.stringify(value)));

/** Longitud DER. */
function derLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return [0x80 | bytes.length, ...bytes];
}
const der = (tag, content) => new Uint8Array([tag, ...derLength(content.length), ...content]);

/** Envuelve una clave RSA PKCS#1 («BEGIN RSA PRIVATE KEY») en PKCS#8, que es lo que acepta WebCrypto. */
function pkcs1ToPkcs8(pkcs1) {
  const version = [0x02, 0x01, 0x00];
  const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, [...version, ...algorithm, ...der(0x04, pkcs1)]);
}

/** Comprueba el formato del PEM sin importarlo. Devuelve el PEM limpio o lanza KeyFormatError. */
export function checkPem(text) {
  if (typeof text !== 'string' || text.length > MAX_PEM_LENGTH) throw new KeyFormatError();
  const match = PEM_RE.exec(text);
  if (!match || Boolean(match[1]) !== Boolean(match[3])) throw new KeyFormatError();
  return match[0];
}

/** Importa la clave privada como CryptoKey no extraíble, solo para firmar. */
export async function importPrivateKey(pemText) {
  const match = PEM_RE.exec(checkPem(pemText));
  let bytes = base64ToBytes(match[2]);
  if (match[1]) bytes = pkcs1ToPkcs8(bytes);
  try {
    return await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new KeyFormatError();
  } finally {
    bytes.fill(0);
  }
}

/**
 * JWT de la aplicación: cabecera { typ, alg: RS256, kid: id de la aplicación } y cuerpo
 * { iss, aud, iat, exp }. Validez corta (1 h; el máximo que admite Enable Banking es 24 h).
 */
export async function signAppJwt(privateKey, appId, { now = Date.now(), ttlSeconds = 3600 } = {}) {
  const iat = Math.floor(now / 1000);
  const header = jsonPart({ typ: 'JWT', alg: 'RS256', kid: appId });
  const body = jsonPart({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + ttlSeconds });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, encoder.encode(`${header}.${body}`));
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
}
