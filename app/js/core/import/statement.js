// De una tabla (Excel o CSV) a apuntes brutos: localiza la fila de cabecera, reconoce las columnas
// por su nombre (con plantilla exacta para Ruralvía) y convierte fechas e importes.
// Si no se reconocen las columnas, devuelve las cabeceras para que la persona las asigne.

import { parseAmount } from '../money.js';
import { isISODate, toISO } from '../dates.js';
import { foldText } from '../text.js';
import { ImportError, normalizeIban } from './normalize.js';

/** Nombres de columna conocidos (sin tildes ni mayúsculas). */
const SYNONYMS = {
  date: ['fecha de la operacion', 'fecha operacion', 'f operacion', 'fecha contable', 'fecha', 'date', 'fecha movimiento'],
  vdate: ['fecha valor', 'f valor', 'value date'],
  text: ['tipo movimiento', 'concepto', 'descripcion', 'concepto comun', 'movimiento', 'detalle', 'description', 'concepto propio'],
  amount: ['importe', 'importe eur', 'importe euros', 'cantidad', 'amount'],
  debit: ['cargo', 'cargos', 'debe', 'debito'],
  credit: ['abono', 'abonos', 'haber', 'credito'],
  balance: ['saldo', 'saldo eur', 'saldo disponible', 'balance'],
  ext: ['nro apunte', 'n apunte', 'no apunte', 'numero de apunte', 'num apunte', 'apunte', 'referencia', 'n referencia'],
};
export const FIELDS = Object.keys(SYNONYMS);
const REQUIRED = ['date', 'text'];

const key = (v) => foldText(String(v ?? '')).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Plantillas de bancos concretos: cabecera exacta → nombre y forma del identificador. */
const TEMPLATES = [
  {
    id: 'ruralvia',
    name: 'Ruralvía (Grupo Caja Rural)',
    header: ['fecha de la operacion', 'fecha valor', 'tipo movimiento', 'importe', 'saldo', 'nro apunte'],
    extPrefix: 'apunte:',
  },
];

function matchColumns(header) {
  const keys = header.map(key);
  const columns = {};
  for (const field of FIELDS) {
    for (const name of SYNONYMS[field]) {
      const i = keys.findIndex((k, idx) => k === name && !Object.values(columns).includes(idx));
      if (i >= 0) {
        columns[field] = i;
        break;
      }
    }
  }
  return columns;
}

const isComplete = (c) => REQUIRED.every((f) => c[f] !== undefined) && (c.amount !== undefined || (c.debit !== undefined && c.credit !== undefined));

/** Busca la cabecera en las primeras filas y el IBAN de la cuenta si aparece encima. */
export function detectLayout(rows) {
  let iban = '';
  for (let r = 0; r < Math.min(rows.length, 40); r += 1) {
    const row = rows[r] ?? [];
    for (const cell of row) {
      const candidate = normalizeIban(typeof cell === 'string' ? cell : '');
      if (candidate && !iban) iban = candidate;
    }
    const columns = matchColumns(row);
    if (isComplete(columns)) {
      const header = row.map(key);
      const template = TEMPLATES.find((t) => t.header.every((h, i) => header[i] === h)) ?? null;
      return { headerRow: r, columns, template, iban, headers: row.map((v) => String(v ?? '')) };
    }
  }
  // Sin cabecera reconocible: se propone la primera fila con 3+ celdas como cabecera.
  const guess = rows.findIndex((row) => (row ?? []).filter((v) => v !== null).length >= 3);
  return { headerRow: guess, columns: guess >= 0 ? matchColumns(rows[guess]) : {}, template: null, iban, headers: guess >= 0 ? rows[guess].map((v) => String(v ?? '')) : [] };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_EN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Fecha de una celda: número de serie de Excel o texto «dd/mm/aaaa», «aaaa-mm-dd», «22-jun-26». */
export function parseCellDate(value, date1904 = false) {
  if (typeof value === 'number') {
    if (value < 1 || value > 200_000) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.floor(value) * 86_400_000);
    return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  if (typeof value !== 'string') return null;
  const t = value.trim().split(/[ T]/)[0];
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return checked(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (m) return checked(fullYear(+m[3]), +m[2], +m[1]);
  m = /^(\d{1,2})[-/. ]([a-zA-Z]{3})[a-z]*[-/. ](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const name = foldText(m[2]);
    const month = (MONTHS.indexOf(name) + 1) || (MONTHS_EN.indexOf(name) + 1);
    return month ? checked(fullYear(+m[3]), month, +m[1]) : null;
  }
  return null;
}
const fullYear = (y) => (y < 100 ? 2000 + y : y);
function checked(y, mo, d) {
  const iso = mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? toISO(y, mo, d) : null;
  return iso && isISODate(iso) ? iso : null;
}

/** Importe en céntimos con signo: número de la hoja o texto «-27,07», «1.234,56», «12,50 €». */
export function parseCellAmount(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    const cents = Math.round(value * 100);
    return Object.is(cents, -0) ? 0 : cents;
  }
  if (typeof value !== 'string') return null;
  let t = value.trim().replace(/\s|€|EUR/gi, '');
  if (/^\(.*\)$/.test(t)) t = `-${t.slice(1, -1)}`; // (12,00) = negativo
  if (/^[\d.,]+-$/.test(t)) t = `-${t.slice(0, -1)}`; // 12,00- = negativo
  if (/^\+/.test(t)) t = t.slice(1);
  return parseAmount(t, { allowNegative: true });
}

/**
 * Convierte la tabla a apuntes brutos con un mapa de columnas.
 * Devuelve { raws, rejected } (rejected: filas con datos que no se han podido interpretar).
 */
export function tableToRaws(rows, layout, { date1904 = false } = {}) {
  const { columns, headerRow, template } = layout;
  if (!isComplete(columns)) throw new ImportError('Faltan columnas: necesito al menos fecha, concepto e importe.', 'columns');
  const raws = [];
  let rejected = 0;
  for (let r = headerRow + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    if (row.every((v) => v === null || v === '')) continue;
    const bdate = parseCellDate(row[columns.date], date1904);
    let amount = columns.amount !== undefined ? parseCellAmount(row[columns.amount]) : null;
    if (amount === null && columns.debit !== undefined) {
      const debit = parseCellAmount(row[columns.debit]);
      const credit = parseCellAmount(row[columns.credit]);
      if (debit) amount = -Math.abs(debit);
      else if (credit) amount = Math.abs(credit);
    }
    if (!bdate || !amount) {
      rejected += 1;
      continue;
    }
    const extCell = columns.ext !== undefined ? row[columns.ext] : null;
    const ext = extCell === null || extCell === undefined || extCell === '' ? '' : `${template?.extPrefix ?? 'ref:'}${String(extCell).trim()}`;
    const balance = columns.balance !== undefined ? parseCellAmount(row[columns.balance]) : null;
    raws.push({
      ext,
      bdate,
      vdate: columns.vdate !== undefined ? parseCellDate(row[columns.vdate], date1904) : null,
      amount,
      text: String(row[columns.text] ?? ''),
      status: 'booked',
      bal: balance,
    });
  }
  return { raws, rejected };
}
