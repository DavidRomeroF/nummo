// Modelo de datos: forma de cada entidad, validación estricta (copias) o de reparación
// (datos propios), estado inicial y reparto en bloques cifrados ("buckets").

import { newId, isId } from './ids.js';
import { isCents } from './money.js';
import { isISODate } from './dates.js';
import { cleanText, cleanLetters } from './text.js';
import {
  COLOR_KEYS, PICKER_ICONS, ACCOUNT_TYPE_KEYS, accountTypeInfo,
  DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, AUTO_LOCK_OPTIONS, DEFAULT_AUTO_LOCK,
} from './catalog.js';

export const SCHEMA_VERSION = 1;
export const CORE_BUCKET = 'core';
export const LIMITS = {
  name: 40, note: 140,
  // 100.000 movimientos ≈ 10 al día durante 27 años; la copia cabe en MAX_BACKUP_BYTES (backup.js).
  accounts: 100, categories: 300, debts: 1000, budgets: 300, recurring: 300, movements: 100_000,
};
export const MOVEMENT_TYPES = ['expense', 'income', 'transfer', 'debt'];
export const DEBT_KINDS = ['owe', 'owed']; // debo / me deben
export const DEBT_FLOWS = ['add', 'pay']; // la deuda crece / se paga
export const FREQUENCIES = ['weekly', 'monthly', 'yearly'];
export const MAX_INTERVAL = 12;
const MAX_RECURRING_INDEX = 100_000;
const AUTO_LOCK_VALUES = AUTO_LOCK_OPTIONS.map((o) => o.seconds);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const fail = (message) => {
  throw new ValidationError(message);
};
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const orderOf = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

function requireId(value, what) {
  return isId(value) ? value : fail(`${what}: identificador no válido.`);
}

function positiveCents(value, what) {
  return isCents(value, { min: 1 }) ? value : fail(`${what}: el importe debe ser mayor que 0.`);
}

// ---------------------------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------------------------

export function normalizeAccount(raw) {
  if (!isObject(raw)) fail('Cuenta no válida.');
  const name = cleanText(raw.name, LIMITS.name) || fail('La cuenta necesita un nombre.');
  const type = pick(raw.type, ACCOUNT_TYPE_KEYS, 'other');
  const initial = raw.initial ?? 0;
  if (!isCents(initial)) fail(`Cuenta «${name}»: saldo inicial no válido.`);
  return {
    id: requireId(raw.id, `Cuenta «${name}»`),
    name,
    type,
    icon: pick(raw.icon, PICKER_ICONS, accountTypeInfo(type).icon),
    letters: cleanLetters(raw.letters),
    color: pick(raw.color, COLOR_KEYS, 'blue'),
    initial,
    includeInTotal: raw.includeInTotal !== false,
    archived: raw.archived === true,
    order: orderOf(raw.order),
  };
}

export function normalizeCategory(raw) {
  if (!isObject(raw)) fail('Categoría no válida.');
  const name = cleanText(raw.name, LIMITS.name) || fail('La categoría necesita un nombre.');
  return {
    id: requireId(raw.id, `Categoría «${name}»`),
    kind: pick(raw.kind, ['expense', 'income'], null) ?? fail(`Categoría «${name}»: tipo no válido.`),
    name,
    icon: pick(raw.icon, PICKER_ICONS, 'tag'),
    color: pick(raw.color, COLOR_KEYS, 'gray'),
    archived: raw.archived === true,
    order: orderOf(raw.order),
  };
}

export function normalizeDebt(raw) {
  if (!isObject(raw)) fail('Deuda no válida.');
  const name = cleanText(raw.name, LIMITS.name) || fail('La deuda necesita un nombre.');
  if (raw.dueDate != null && !isISODate(raw.dueDate)) fail(`Deuda «${name}»: fecha límite no válida.`);
  return {
    id: requireId(raw.id, `Deuda «${name}»`),
    kind: pick(raw.kind, DEBT_KINDS, null) ?? fail(`Deuda «${name}»: tipo no válido.`),
    name,
    note: cleanText(raw.note, LIMITS.note),
    dueDate: raw.dueDate ?? null,
  };
}

export function normalizeBudget(raw) {
  if (!isObject(raw)) fail('Presupuesto no válido.');
  return {
    id: requireId(raw.id, 'Presupuesto'),
    categoryId: raw.categoryId == null ? null : requireId(raw.categoryId, 'Presupuesto'),
    amount: positiveCents(raw.amount, 'Presupuesto'),
  };
}

/** Campos comunes de un movimiento y de la plantilla de un movimiento programado. */
function normalizeMovementFields(raw, what) {
  if (!isObject(raw)) fail(`${what}: formato no válido.`);
  const type = pick(raw.type, MOVEMENT_TYPES, null) ?? fail(`${what}: tipo no válido.`);
  const out = { type, amount: positiveCents(raw.amount, what) };
  if (type === 'debt') {
    out.debtId = requireId(raw.debtId, what);
    out.flow = pick(raw.flow, DEBT_FLOWS, null) ?? fail(`${what}: operación de deuda no válida.`);
    out.accountId = raw.accountId == null ? null : requireId(raw.accountId, what);
  } else {
    out.accountId = requireId(raw.accountId, what);
    if (type === 'transfer') {
      out.toAccountId = requireId(raw.toAccountId, what);
      if (out.toAccountId === out.accountId) fail(`${what}: el origen y el destino deben ser cuentas distintas.`);
    } else {
      out.categoryId = requireId(raw.categoryId, what);
    }
  }
  out.note = cleanText(raw.note, LIMITS.note);
  return out;
}

export function normalizeMovement(raw) {
  const what = 'Movimiento';
  if (!isObject(raw)) fail(`${what}: formato no válido.`);
  const movement = {
    id: requireId(raw.id, what),
    date: isISODate(raw.date) ? raw.date : fail(`${what}: fecha no válida.`),
    ...normalizeMovementFields(raw, what),
    ts: Number.isSafeInteger(raw.ts) && raw.ts >= 0 ? raw.ts : 0,
  };
  if (isId(raw.recurringId)) movement.recurringId = raw.recurringId;
  return movement;
}

export function normalizeRecurring(raw) {
  const what = 'Movimiento programado';
  if (!isObject(raw)) fail(`${what}: formato no válido.`);
  const interval = raw.interval ?? 1;
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > MAX_INTERVAL) fail(`${what}: periodicidad no válida.`);
  if (!isISODate(raw.startDate)) fail(`${what}: fecha de inicio no válida.`);
  if (raw.endDate != null && (!isISODate(raw.endDate) || raw.endDate < raw.startDate)) fail(`${what}: fecha de fin no válida.`);
  const index = raw.index ?? 0;
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_RECURRING_INDEX) fail(`${what}: estado no válido.`);
  return {
    id: requireId(raw.id, what),
    active: raw.active !== false,
    frequency: pick(raw.frequency, FREQUENCIES, null) ?? fail(`${what}: frecuencia no válida.`),
    interval,
    startDate: raw.startDate,
    index,
    endDate: raw.endDate ?? null,
    anchorDay: Number.isInteger(raw.anchorDay) && raw.anchorDay >= 29 && raw.anchorDay <= 31 ? raw.anchorDay : null,
    template: normalizeMovementFields(raw.template, what),
  };
}

export function normalizeSettings(raw) {
  const s = isObject(raw) ? raw : {};
  return {
    autoLockSec: pick(s.autoLockSec, AUTO_LOCK_VALUES, DEFAULT_AUTO_LOCK),
    lastBackupAt: Number.isSafeInteger(s.lastBackupAt) && s.lastBackupAt > 0 ? s.lastBackupAt : null,
    lastAccountId: isId(s.lastAccountId) ? s.lastAccountId : null,
    installHintDismissed: s.installHintDismissed === true,
  };
}

// ---------------------------------------------------------------------------------------------
// Conjunto completo
// ---------------------------------------------------------------------------------------------

/**
 * Valida un conjunto de datos completo, incluida la integridad entre entidades.
 * - strict: true  → cualquier error rechaza todo (restaurar copias: fallar de forma cerrada).
 * - strict: false → se descartan los elementos inválidos (cargar datos propios sin bloquear la app).
 * Devuelve { data, dropped }.
 */
export function normalizeData(raw, { strict = true } = {}) {
  if (!isObject(raw)) fail('Los datos no tienen un formato válido.');
  if (raw.version !== SCHEMA_VERSION) {
    fail(Number.isInteger(raw.version) && raw.version > SCHEMA_VERSION
      ? 'Los datos son de una versión más nueva de la app. Actualiza la app e inténtalo de nuevo.'
      : 'Versión de datos no reconocida.');
  }
  let dropped = 0;
  const attempt = (fn) => {
    try {
      return fn();
    } catch (error) {
      if (strict || !(error instanceof ValidationError)) throw error;
      dropped += 1;
      return null;
    }
  };
  const collect = (list, limit, label, normalize) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) fail(`${label}: formato no válido.`);
    if (list.length > limit) fail(`${label}: hay demasiados elementos (máximo ${limit}).`);
    const seen = new Set();
    const out = [];
    for (const item of list) {
      const value = attempt(() => {
        const normalized = normalize(item);
        if (seen.has(normalized.id)) fail(`${label}: identificador repetido.`);
        return normalized;
      });
      if (value) {
        seen.add(value.id);
        out.push(value);
      }
    }
    return out;
  };

  const accounts = collect(raw.accounts, LIMITS.accounts, 'Cuentas', normalizeAccount);
  const categories = collect(raw.categories, LIMITS.categories, 'Categorías', normalizeCategory);
  const debts = collect(raw.debts, LIMITS.debts, 'Deudas', normalizeDebt);
  const accountIds = new Set(accounts.map((a) => a.id));
  const categoryKind = new Map(categories.map((c) => [c.id, c.kind]));
  const debtIds = new Set(debts.map((d) => d.id));

  const checkRefs = (m, what) => {
    if (m.accountId !== null && !accountIds.has(m.accountId)) fail(`${what}: la cuenta no existe.`);
    if (m.type === 'transfer' && !accountIds.has(m.toAccountId)) fail(`${what}: la cuenta de destino no existe.`);
    if ((m.type === 'expense' || m.type === 'income') && categoryKind.get(m.categoryId) !== m.type) {
      fail(`${what}: la categoría no existe o no corresponde al tipo.`);
    }
    if (m.type === 'debt' && !debtIds.has(m.debtId)) fail(`${what}: la deuda no existe.`);
    return m;
  };

  const recurring = collect(raw.recurring, LIMITS.recurring, 'Programados', (item) => {
    const r = normalizeRecurring(item);
    checkRefs(r.template, 'Movimiento programado');
    return r;
  });
  const recurringIds = new Set(recurring.map((r) => r.id));

  const movements = collect(raw.movements, LIMITS.movements, 'Movimientos', (item) => {
    const m = checkRefs(normalizeMovement(item), 'Movimiento');
    if (m.recurringId && !recurringIds.has(m.recurringId)) delete m.recurringId;
    return m;
  });

  const budgetKeys = new Set();
  const budgets = collect(raw.budgets, LIMITS.budgets, 'Presupuestos', (item) => {
    const b = normalizeBudget(item);
    if (b.categoryId !== null && categoryKind.get(b.categoryId) !== 'expense') fail('Presupuesto: la categoría no existe.');
    const key = b.categoryId ?? 'total';
    if (budgetKeys.has(key)) fail('Presupuesto repetido para la misma categoría.');
    budgetKeys.add(key);
    return b;
  });

  const settings = normalizeSettings(raw.settings);
  if (settings.lastAccountId && !accountIds.has(settings.lastAccountId)) settings.lastAccountId = null;

  const byOrder = (a, b) => a.order - b.order;
  accounts.sort(byOrder).forEach((a, i) => { a.order = i; });
  categories.sort(byOrder).forEach((c, i) => { c.order = i; });

  return {
    data: { version: SCHEMA_VERSION, settings, accounts, categories, debts, budgets, recurring, movements },
    dropped,
  };
}

/** Datos de una instalación nueva: cuentas y categorías de ejemplo, sin movimientos. */
export function createInitialState() {
  return {
    version: SCHEMA_VERSION,
    settings: normalizeSettings({}),
    accounts: DEFAULT_ACCOUNTS.map((a, i) => ({
      id: newId(), letters: '', initial: 0, includeInTotal: true, archived: false, order: i, ...a,
    })),
    categories: DEFAULT_CATEGORIES.map((c, i) => ({ id: newId(), archived: false, order: i, ...c })),
    debts: [],
    budgets: [],
    recurring: [],
    movements: [],
  };
}

// ---------------------------------------------------------------------------------------------
// Bloques de almacenamiento: 'core' (todo menos movimientos) + 'mov-AAAA' (movimientos de un año).
// Guardar un movimiento solo recifra su año, no todo el historial.
// ---------------------------------------------------------------------------------------------

const MOVEMENT_BUCKET_RE = /^mov-\d{4}$/;
export const movementBucket = (date) => `mov-${date.slice(0, 4)}`;
export const isBucketKey = (key) => key === CORE_BUCKET || MOVEMENT_BUCKET_RE.test(key);

export function buildBucket(state, key) {
  if (key === CORE_BUCKET) {
    const { movements, ...core } = state;
    return core;
  }
  const prefix = `${key.slice(4)}-`;
  return { movements: state.movements.filter((m) => m.date.startsWith(prefix)) };
}

export function allBucketKeys(state) {
  const keys = new Set([CORE_BUCKET]);
  for (const m of state.movements) keys.add(movementBucket(m.date));
  return keys;
}

/** Une los bloques descifrados en un único objeto (aún sin validar). */
export function mergeBuckets(buckets) {
  const core = buckets.get(CORE_BUCKET);
  if (!isObject(core)) fail('Faltan los datos principales.');
  const movements = [];
  for (const [key, value] of buckets) {
    if (!MOVEMENT_BUCKET_RE.test(key) || !Array.isArray(value?.movements)) continue;
    for (const m of value.movements) movements.push(m);
  }
  return { ...core, movements };
}
