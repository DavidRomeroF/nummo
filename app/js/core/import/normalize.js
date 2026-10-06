// Primer paso de toda importación (banco conectado o archivo del banco): se valida cada apunte
// bruto, se calcula su huella para reconocerlo al reimportar y se extrae el comercio del concepto.
// A partir de aquí Nummo ya no distingue de dónde vino el movimiento.
//
// Apunte bruto (RawTransaction) que entregan los proveedores y los lectores de archivos:
//   { ext?, bdate, vdate?, amount, currency?, text, cp?, cpIban?, status?, bal?, mcc? }
//   - ext:    identificador del banco (o número de apunte del extracto); '' si no hay.
//   - bdate:  fecha contable 'AAAA-MM-DD'; vdate: fecha valor (opcional).
//   - amount: céntimos con signo (negativo = sale dinero). Nunca 0.
//   - text:   concepto tal como lo da el banco; cp: contrapartida/comercio si el banco la da.
//   - cpIban: IBAN de la contrapartida si lo da el banco (solo se guarda su hash).
//   - status: 'booked' (contabilizado) | 'pending' (pendiente). bal: saldo tras el apunte.

import { isCents } from '../money.js';
import { isISODate, diffDays } from '../dates.js';
import { cleanText, foldText } from '../text.js';
import { LIMITS, ValidationError } from '../model.js';

const MAX_VALUE_DATE_GAP = 7; // días: la fecha valor de una compra con tarjeta suele ir 1-3 días antes

export class ImportError extends ValidationError {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

/** IBAN sin espacios y en mayúsculas; '' si no parece un IBAN. */
export function normalizeIban(value) {
  if (typeof value !== 'string') return '';
  const iban = value.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : '';
}

/** «•••• 1818»: lo único del IBAN que se muestra en la app. */
export function maskIban(iban) {
  const clean = normalizeIban(iban);
  return clean ? `•••• ${clean.slice(-4)}` : '';
}

/** Hash SHA-256 (hex) de un IBAN normalizado: permite reconocer cuentas sin guardar el número. */
export async function hashIban(iban) {
  const clean = normalizeIban(iban);
  if (!clean) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`nummo:iban:v1:${clean}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** FNV-1a de 64 bits en hexadecimal (rápido y estable; no es criptográfico ni necesita serlo). */
function fnv1a64(text) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

/** Concepto comparable: sin mayúsculas, tildes ni espacios repetidos. */
export const comparableText = (text) => foldText(text).replace(/\s+/g, ' ').trim();

/**
 * Comercio o contrapartida a partir del concepto, quitando prefijos del banco
 * («tj-», «rcbo.», «trf.», «compra tarjeta»…) y referencias numéricas largas.
 */
export function extractMerchant(text) {
  let t = cleanText(text, LIMITS.note);
  if (/^(cargo|abono)\s+bizum\b/i.test(t)) return 'Bizum';
  t = t
    .replace(/^(compra\s+(con\s+)?tarj(eta)?\.?|pago\s+(con\s+)?tarj(eta)?\.?|tarj(eta)?\.?|tj)\s*[-.:]?\s*/i, '')
    .replace(/^(rcbo|recibo|adeudo|domiciliaci[oó]n)\s*[-.:]?\s*/i, '')
    .replace(/^(trf|transf|transferencia)\s*[-.:]?\s*(a\s+favor\s+de|de|a)?\s*/i, '')
    .replace(/\b[a-z]{0,4}\d{6,}\b/gi, '') // referencias: «eur2606182035», «2096081936»
    .replace(/\s+/g, ' ')
    .trim();
  return cleanText(t, LIMITS.name);
}

/** Fecha que se muestra: la fecha valor si es anterior y cercana (día real de la compra). */
export function displayDate(bdate, vdate) {
  if (!vdate || vdate >= bdate) return bdate;
  return diffDays(vdate, bdate) <= MAX_VALUE_DATE_GAP ? vdate : bdate;
}

/** Valida un apunte bruto. Lanza ImportError con un mensaje sin datos del movimiento. */
export function normalizeRaw(raw) {
  if (!raw || typeof raw !== 'object') throw new ImportError('Apunte con formato no válido.');
  if (!isISODate(raw.bdate)) throw new ImportError('Apunte sin fecha válida.', 'date');
  if (!isCents(raw.amount) || raw.amount === 0) throw new ImportError('Apunte con importe no válido.', 'amount');
  const currency = typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : 'EUR';
  const text = cleanText(raw.text, LIMITS.note);
  const cp = cleanText(raw.cp, LIMITS.name) || extractMerchant(text);
  return {
    ext: typeof raw.ext === 'string' ? cleanText(raw.ext, LIMITS.ext) : '',
    bdate: raw.bdate,
    vdate: isISODate(raw.vdate) ? raw.vdate : null,
    amount: raw.amount,
    currency,
    text: text || cp || 'Movimiento',
    cp,
    cpIbanRaw: normalizeIban(raw.cpIban),
    status: raw.status === 'pending' ? 'pending' : 'booked',
    bal: isCents(raw.bal) ? raw.bal : null,
    mcc: typeof raw.mcc === 'string' && /^\d{4}$/.test(raw.mcc) ? raw.mcc : '',
  };
}

/**
 * Valida y prepara una lista de apuntes de UNA cuenta.
 * La huella es fecha contable + importe + concepto + número de aparición ese día, así dos cafés
 * idénticos el mismo día son «#1» y «#2» y no se confunden con un duplicado.
 * Devuelve { items, rejected } (rejected: número de apuntes descartados por inválidos).
 */
export async function prepareItems(raws) {
  const items = [];
  let rejected = 0;
  for (const raw of raws) {
    try {
      items.push(normalizeRaw(raw));
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      rejected += 1;
    }
  }
  // Orden estable dentro de cada grupo idéntico: por identificador del banco si lo hay.
  const groups = new Map();
  for (const item of items) {
    const base = `${item.bdate}|${item.amount}|${comparableText(item.text)}`;
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(item);
  }
  for (const [base, group] of groups) {
    if (group.every((i) => i.ext)) group.sort((a, b) => a.ext.localeCompare(b.ext, 'en', { numeric: true }));
    const hash = fnv1a64(base);
    group.forEach((item, i) => { item.fp = `${hash}#${i + 1}`; });
  }
  for (const item of items) {
    item.cpIban = item.cpIbanRaw ? await hashIban(item.cpIbanRaw) : '';
    delete item.cpIbanRaw;
    item.date = displayDate(item.bdate, item.vdate);
  }
  return { items, rejected };
}
