// Lectura de extractos bancarios en Excel (.xlsx) y CSV, sin librerías.
// - .xlsx es un ZIP con XML: se lee el directorio del ZIP, se descomprime con DecompressionStream
//   (nativo; iOS 16.4+) y se extraen las celdas con expresiones acotadas (sin DOMParser ni HTML).
// - Límites contra archivos maliciosos: tamaño del archivo, número de entradas, tamaño
//   descomprimido (bombas ZIP) y número de filas.
// Devuelven siempre una tabla: filas de celdas (texto, número o null).

import { ImportError } from './normalize.js';

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const MAX_ENTRIES = 500;
export const MAX_ROWS = 50_000;
const MAX_COLS = 60;

const tooBig = () => new ImportError('El archivo es demasiado grande.', 'size');
const unreadable = () => new ImportError('No se puede leer el archivo. ¿Es un Excel (.xlsx) o un CSV del banco?', 'format');

// --- ZIP --------------------------------------------------------------------------------------

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Índice de entradas de un ZIP: Map nombre → { method, compSize, size, offset }. */
export function readZipDirectory(bytes) {
  if (bytes.length < 22) throw unreadable();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i -= 1) {
    if (u32(bytes, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw unreadable();
  const count = u16(bytes, eocd + 10);
  const dirOffset = u32(bytes, eocd + 16);
  if (count > MAX_ENTRIES || dirOffset >= bytes.length) throw unreadable();
  const entries = new Map();
  let p = dirOffset;
  const decoder = new TextDecoder('utf-8');
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw unreadable();
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    if (compSize === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw unreadable(); // ZIP64: no
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data, limit) {
  if (typeof DecompressionStream === 'undefined') {
    throw new ImportError('Este navegador no puede abrir archivos Excel. Exporta el extracto como CSV.', 'unsupported');
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw tooBig();
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Contenido descomprimido de una entrada del ZIP (o null si no existe). */
export async function readZipEntry(bytes, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  const p = entry.offset;
  if (p + 30 > bytes.length || u32(bytes, p) !== 0x04034b50) throw unreadable();
  const start = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  const data = bytes.subarray(start, start + entry.compSize);
  if (data.length !== entry.compSize) throw unreadable();
  if (entry.method === 0) {
    if (data.length > MAX_ENTRY_BYTES) throw tooBig();
    return data;
  }
  if (entry.method === 8) return inflateRaw(data, MAX_ENTRY_BYTES);
  throw unreadable();
}

// --- XML mínimo de hojas de cálculo -----------------------------------------------------------

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e[0] !== '#') return ENTITY[e];
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : null;
};

/** Texto de un fragmento con <t>…</t> (cadenas compartidas o en línea, con o sin formato). */
const textRuns = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)].map((m) => decodeXml(m[1] ?? '')).join('');

function colIndex(ref) {
  const letters = /^([A-Z]{1,3})\d+$/.exec(ref ?? '')?.[1];
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Lee la primera hoja de un .xlsx. Devuelve { rows, date1904 }. */
export async function readXlsx(bytes) {
  if (bytes.length > MAX_FILE_BYTES) throw tooBig();
  const entries = readZipDirectory(bytes);
  const text = async (name) => {
    const data = await readZipEntry(bytes, entries, name);
    return data ? new TextDecoder('utf-8').decode(data) : null;
  };
  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw unreadable();
  const date1904 = /<workbookPr[^>]*\sdate1904="(1|true)"/.test(workbook);
  // Primera hoja según el libro y sus relaciones.
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const firstSheet = /<sheet\s([^>]*)\/?>/.exec(workbook);
  const rels = await text('xl/_rels/workbook.xml.rels');
  const rid = firstSheet ? attr(firstSheet[1], 'r:id') : null;
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\s([^>]*)\/?>/g)) {
      if (attr(m[1], 'Id') !== rid) continue;
      const target = attr(m[1], 'Target') ?? '';
      const clean = target.replace(/^\/?(xl\/)?/, '');
      if (/^[\w./-]+\.xml$/.test(clean) && !clean.includes('..')) sheetPath = `xl/${clean}`;
    }
  }
  const sheet = await text(sheetPath);
  if (!sheet) throw unreadable();
  const sharedXml = await text('xl/sharedStrings.xml');
  const shared = sharedXml ? [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1])) : [];

  const rows = [];
  for (const rowMatch of sheet.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    if (rows.length >= MAX_ROWS) throw new ImportError(`El archivo tiene más de ${MAX_ROWS} filas.`, 'size');
    const rowNumber = Number(attr(rowMatch[1] ?? '', 'r')) || rows.length + 1;
    const cells = [];
    for (const c of rowMatch[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1] ?? '';
      const col = colIndex(attr(attrs, 'r'));
      const index = col >= 0 ? col : cells.length;
      if (index >= MAX_COLS) continue;
      const body = c[2] ?? '';
      const type = attr(attrs, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = null;
      if (type === 's') value = shared[Number(v)] ?? null;
      else if (type === 'inlineStr') value = textRuns(body);
      else if (type === 'str' || type === 'e') value = v === undefined ? null : decodeXml(v);
      else if (type === 'b') value = v === '1';
      else if (v !== undefined && v.trim() !== '') value = Number(v);
      if (typeof value === 'number' && !Number.isFinite(value)) value = null;
      cells[index] = value;
    }
    // Las filas vacías intermedias se conservan para que las posiciones coincidan con el Excel.
    while (rows.length < rowNumber - 1 && rows.length < MAX_ROWS) rows.push([]);
    rows.push(Array.from(cells, (v) => v ?? null));
  }
  return { rows, date1904 };
}

// --- CSV ----------------------------------------------------------------------------------------

/** Texto de un CSV: UTF-8 si es válido; si no, Windows-1252 (habitual en bancos españoles). */
export function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 15);
  let best = ';';
  let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = sample.map((line) => line.replace(/"[^"]*"/g, '').split(d).length - 1).filter((n) => n > 0);
    const score = counts.length ? counts.length * 10 + Math.min(...counts) : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** CSV con comillas (RFC 4180) y separador detectado. Devuelve { rows }. */
export function readCsv(bytes) {
  if (bytes.length > MAX_FILE_BYTES) throw tooBig();
  const text = decodeText(bytes);
  const d = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row.slice(0, MAX_COLS).map((v) => (v.trim() === '' ? null : v.trim())));
      if (rows.length > MAX_ROWS) throw new ImportError(`El archivo tiene más de ${MAX_ROWS} filas.`, 'size');
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new ImportError('El CSV está mal formado (comillas sin cerrar).', 'format');
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row.slice(0, MAX_COLS).map((v) => (v.trim() === '' ? null : v.trim())));
  }
  return { rows, date1904: false };
}

/** Lee un archivo de extracto según su contenido (no su nombre). */
export async function readStatementFile(bytes) {
  if (!(bytes instanceof Uint8Array)) throw unreadable();
  if (bytes.length > MAX_FILE_BYTES) throw tooBig();
  if (bytes.length >= 4 && u32(bytes, 0) === 0x04034b50) return readXlsx(bytes);
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    throw new ImportError('Es un Excel antiguo (.xls). Ábrelo y guárdalo como .xlsx o CSV.', 'unsupported');
  }
  return readCsv(bytes);
}
