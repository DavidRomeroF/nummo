// Identificadores aleatorios cortos (12 caracteres alfanuméricos, ~71 bits de entropía).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ID_RE = /^[A-Za-z0-9]{8,24}$/;

export function newId(length = 12) {
  const out = [];
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const byte of bytes) {
      // Se descartan los valores ≥ 248 para que los 62 símbolos sean equiprobables.
      if (byte < 248) out.push(ALPHABET[byte % 62]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

export const isId = (value) => typeof value === 'string' && ID_RE.test(value);
