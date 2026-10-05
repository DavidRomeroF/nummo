// Copias de seguridad cifradas con contraseña propia y exportación a CSV.
// Formato del archivo (JSON): { format, version, kdf: {..., salt}, cipher: {..., iv}, data } con
// los binarios en Base64. Al restaurar se valida todo en modo estricto antes de tocar nada.

import {
  DEFAULT_ITERATIONS, MIN_ITERATIONS, MAX_ITERATIONS, SALT_BYTES, IV_BYTES,
  randomBytes, deriveKey, encryptJSON, decryptJSON, toBase64, fromBase64,
} from './crypto.js';
import { normalizeData, ValidationError } from './model.js';
import { centsToInput } from './money.js';
import { todayISO } from './dates.js';
import { debtAccountSign } from './finance.js';

export const BACKUP_FORMAT = 'app-dinero-backup';
export const BACKUP_VERSION = 1;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const AAD = 'app-dinero:backup:v1';

export class BackupPasswordError extends Error {
  constructor() {
    super('Contraseña incorrecta o archivo dañado.');
    this.name = 'BackupPasswordError';
  }
}

const invalidFile = () => new ValidationError('El archivo no es una copia de seguridad válida de esta app.');

export function checkPassword(password) {
  if (typeof password !== 'string' || Array.from(password).length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
}

/** Devuelve { text, filename } listos para guardar. */
export async function createBackup(state, password, { iterations = DEFAULT_ITERATIONS, now = new Date() } = {}) {
  checkPassword(password);
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt, iterations);
  const { iv, ct } = await encryptJSON(key, { exportedAt: now.toISOString(), data: state }, AAD);
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    data: toBase64(ct),
  };
  return { text: JSON.stringify(envelope), filename: `dinero-copia-${todayISO(now)}.json` };
}

/** Comprueba la estructura del archivo (sin contraseña). Lanza ValidationError si no es válido. */
export function parseBackup(text) {
  if (typeof text !== 'string' || text.length > MAX_BACKUP_BYTES) throw invalidFile();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    throw invalidFile();
  }
  if (envelope?.format !== BACKUP_FORMAT) throw invalidFile();
  if (envelope.version !== BACKUP_VERSION) {
    throw new ValidationError('Esta copia es de una versión de la app que no se reconoce. Actualiza la app.');
  }
  const { kdf, cipher } = envelope;
  if (kdf?.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || cipher?.name !== 'AES-GCM') throw invalidFile();
  if (!Number.isSafeInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) {
    throw invalidFile();
  }
  let salt;
  let iv;
  let ct;
  try {
    salt = fromBase64(kdf.salt);
    iv = fromBase64(cipher.iv);
    ct = fromBase64(envelope.data);
  } catch {
    throw invalidFile();
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || ct.length <= 16) throw invalidFile();
  return { iterations: kdf.iterations, salt, iv, ct };
}

/** Descifra y valida (modo estricto). Devuelve { data, exportedAt }. */
export async function openBackup(parsed, password) {
  const key = await deriveKey(password, parsed.salt, parsed.iterations);
  let payload;
  try {
    payload = await decryptJSON(key, { iv: parsed.iv, ct: parsed.ct }, AAD);
  } catch {
    throw new BackupPasswordError();
  }
  if (!payload || typeof payload !== 'object') throw invalidFile();
  const { data } = normalizeData(payload.data, { strict: true });
  return { data, exportedAt: typeof payload.exportedAt === 'string' ? payload.exportedAt : null };
}

// --- CSV (Excel / Numbers en español: separador «;», coma decimal y BOM UTF-8) ------------------

const TYPE_LABELS = { expense: 'Gasto', income: 'Ingreso', transfer: 'Transferencia', debt: 'Deuda' };
const DEBT_LABELS = {
  'owe:add': 'Me prestan', 'owe:pay': 'Pago', 'owed:add': 'Presto', 'owed:pay': 'Cobro',
};

/** Texto entre comillas y neutralizado frente a inyección de fórmulas (=, +, -, @…). */
function textCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCSV(state) {
  const accounts = new Map(state.accounts.map((a) => [a.id, a.name]));
  const categories = new Map(state.categories.map((c) => [c.id, c.name]));
  const debts = new Map(state.debts.map((d) => [d.id, d]));
  const header = ['Fecha', 'Tipo', 'Importe', 'Cuenta', 'Cuenta destino', 'Categoría', 'Deuda', 'Operación', 'Nota'];
  const lines = [header.map(textCell).join(';')];
  const sorted = [...state.movements].sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
  for (const m of sorted) {
    const debt = m.type === 'debt' ? debts.get(m.debtId) : null;
    let signed = m.amount;
    if (m.type === 'expense') signed = -m.amount;
    if (debt && m.accountId) signed = debtAccountSign(debt.kind, m.flow) * m.amount;
    lines.push([
      m.date,
      textCell(TYPE_LABELS[m.type]),
      centsToInput(signed),
      textCell(accounts.get(m.accountId) ?? ''),
      textCell(accounts.get(m.toAccountId) ?? ''),
      textCell(categories.get(m.categoryId) ?? ''),
      textCell(debt?.name ?? ''),
      textCell(debt ? DEBT_LABELS[`${debt.kind}:${m.flow}`] : ''),
      textCell(m.note),
    ].join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
