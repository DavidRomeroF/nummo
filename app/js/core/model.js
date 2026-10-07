// Modelo de datos: forma de cada entidad, validación estricta (copias) o de reparación
// (datos propios), estado inicial y reparto en bloques cifrados ("buckets").

import { newId, isId } from './ids.js';
import { isCents } from './money.js';
import { isISODate } from './dates.js';
import { cleanText, cleanLetters, foldText } from './text.js';
import {
  COLOR_KEYS, PICKER_ICONS, ACCOUNT_TYPE_KEYS, accountTypeInfo,
  DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, AUTO_LOCK_OPTIONS, DEFAULT_AUTO_LOCK,
} from './catalog.js';

export const SCHEMA_VERSION = 2;
/** Versiones que se pueden leer (copias antiguas incluidas). La 1 no tenía bancos ni reglas. */
export const READABLE_VERSIONS = [1, 2];
export const CORE_BUCKET = 'core';
export const LIMITS = {
  name: 40, note: 140,
  // 100.000 movimientos ≈ 10 al día durante 27 años; la copia cabe en MAX_BACKUP_BYTES (backup.js).
  accounts: 100, categories: 300, debts: 1000, budgets: 300, recurring: 300, movements: 100_000,
  connections: 20, rules: 2000, ext: 128, ruleValue: 80, bankName: 60,
};
export const MOVEMENT_STATUSES = ['booked', 'pending'];
export const SOURCE_KINDS = ['bank', 'file'];
/** Cómo se decidió la categoría de un movimiento importado. */
export const CATEGORY_ORIGINS = ['user', 'rule', 'auto', 'none'];
export const BANK_PRODUCTS = ['current', 'savings', 'card', 'deposit', 'other'];
export const CONNECTION_STATUSES = ['pending', 'active', 'expired', 'revoked', 'error'];
export const PROVIDERS = ['enablebanking'];
export const RULE_FIELDS = ['text', 'counterparty', 'mcc'];
export const RULE_OPS = ['contains', 'starts', 'equals'];
const MAX_SYNC_LOG = 12;
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

const centsOrNull = (v) => (isCents(v) ? v : null);
const dateOrNull = (v) => (isISODate(v) ? v : null);
const msOrNull = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const HEX64_RE = /^[0-9a-f]{64}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;
/** Identificadores externos (banco, número de apunte): texto corto, sin espacios raros. */
const cleanExt = (v) => (typeof v === 'string' ? cleanText(v, LIMITS.ext) : '');

// ---------------------------------------------------------------------------------------------
// Entidades
// ---------------------------------------------------------------------------------------------

/**
 * Datos de banco de una cuenta (opcional). El IBAN nunca se guarda entero: solo los 4 últimos
 * dígitos para mostrarlo y un hash SHA-256 para reconocer la cuenta en extractos y transferencias.
 */
export function normalizeAccountBank(raw) {
  if (!isObject(raw)) return null;
  const mask = typeof raw.ibanMasked === 'string' && /^•••• [0-9A-Z]{4}$/.test(raw.ibanMasked) ? raw.ibanMasked : '';
  return {
    connectionId: isId(raw.connectionId) ? raw.connectionId : null,
    externalId: cleanExt(raw.externalId) || null,
    ibanMasked: mask,
    ibanHash: typeof raw.ibanHash === 'string' && HEX64_RE.test(raw.ibanHash) ? raw.ibanHash : '',
    currency: typeof raw.currency === 'string' && CURRENCY_RE.test(raw.currency) ? raw.currency : 'EUR',
    product: pick(raw.product, BANK_PRODUCTS, 'current'),
    bankBalance: centsOrNull(raw.bankBalance),
    availableBalance: centsOrNull(raw.availableBalance),
    balanceAt: dateOrNull(raw.balanceAt),
    followBalance: raw.followBalance !== false,
  };
}

/** Plazo fijo registrado a mano: solo lo que la persona sabe; Nummo no inventa intereses. */
export function normalizeDeposit(raw) {
  if (!isObject(raw)) return null;
  const rate = Number.isSafeInteger(raw.rateBp) && raw.rateBp >= 0 && raw.rateBp <= 10_000 ? raw.rateBp : null;
  const start = dateOrNull(raw.startDate);
  let maturity = dateOrNull(raw.maturityDate);
  if (start && maturity && maturity < start) maturity = null;
  return { principal: centsOrNull(raw.principal), rateBp: rate, startDate: start, maturityDate: maturity };
}

export function normalizeAccount(raw) {
  if (!isObject(raw)) fail('Cuenta no válida.');
  const name = cleanText(raw.name, LIMITS.name) || fail('La cuenta necesita un nombre.');
  const type = pick(raw.type, ACCOUNT_TYPE_KEYS, 'other');
  const initial = raw.initial ?? 0;
  if (!isCents(initial)) fail(`Cuenta «${name}»: saldo inicial no válido.`);
  const account = {
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
  const bank = normalizeAccountBank(raw.bank);
  if (bank) account.bank = bank;
  const deposit = type === 'deposit' ? normalizeDeposit(raw.deposit) : null;
  if (deposit) account.deposit = deposit;
  return account;
}

export function normalizeCategory(raw) {
  if (!isObject(raw)) fail('Categoría no válida.');
  const name = cleanText(raw.name, LIMITS.name) || fail('La categoría necesita un nombre.');
  const category = {
    id: requireId(raw.id, `Categoría «${name}»`),
    kind: pick(raw.kind, ['expense', 'income'], null) ?? fail(`Categoría «${name}»: tipo no válido.`),
    name,
    icon: pick(raw.icon, PICKER_ICONS, 'tag'),
    color: pick(raw.color, COLOR_KEYS, 'gray'),
    archived: raw.archived === true,
    order: orderOf(raw.order),
  };
  // Subcategoría (un solo nivel). Que el padre exista se comprueba con el conjunto completo.
  if (isId(raw.parentId) && raw.parentId !== category.id) category.parentId = raw.parentId;
  return category;
}

/** Origen de un movimiento importado (banco o archivo). Sirve para no duplicar al reimportar. */
export function normalizeSource(raw) {
  if (!isObject(raw)) return null;
  const kind = pick(raw.kind, SOURCE_KINDS, null);
  const bdate = dateOrNull(raw.bdate);
  if (!kind || !bdate) return null;
  return {
    kind,
    ext: cleanExt(raw.ext),
    fp: typeof raw.fp === 'string' && /^[0-9a-f]{16}#\d{1,4}$/.test(raw.fp) ? raw.fp : '',
    bdate,
    vdate: dateOrNull(raw.vdate),
    status: pick(raw.status, MOVEMENT_STATUSES, 'booked'),
    text: cleanText(raw.text, LIMITS.note),
    cp: cleanText(raw.cp, LIMITS.name),
    cpIban: typeof raw.cpIban === 'string' && HEX64_RE.test(raw.cpIban) ? raw.cpIban : '',
    bal: centsOrNull(raw.bal),
    mcc: typeof raw.mcc === 'string' && /^\d{4}$/.test(raw.mcc) ? raw.mcc : '',
    cat: pick(raw.cat, CATEGORY_ORIGINS, 'none'),
    batch: isId(raw.batch) ? raw.batch : null,
  };
}

/** Banco conectado mediante un proveedor de Open Banking. Sin secretos: esos van aparte. */
export function normalizeConnection(raw) {
  if (!isObject(raw)) fail('Conexión bancaria no válida.');
  const bankName = cleanText(raw.bankName, LIMITS.bankName) || fail('Conexión bancaria sin nombre de banco.');
  const log = Array.isArray(raw.syncLog) ? raw.syncLog : [];
  return {
    id: requireId(raw.id, 'Conexión bancaria'),
    provider: pick(raw.provider, PROVIDERS, null) ?? fail('Conexión bancaria: proveedor no válido.'),
    bankName,
    country: typeof raw.country === 'string' && /^[A-Z]{2}$/.test(raw.country) ? raw.country : 'ES',
    status: pick(raw.status, CONNECTION_STATUSES, 'pending'),
    validUntil: msOrNull(raw.validUntil),
    createdAt: msOrNull(raw.createdAt) ?? 0,
    lastSyncAt: msOrNull(raw.lastSyncAt),
    // Intentos recientes (hora y resultado), para respetar el límite de consultas diarias de PSD2.
    syncLog: log.filter((e) => isObject(e) && msOrNull(e.at)).slice(-MAX_SYNC_LOG)
      .map((e) => ({ at: e.at, ok: e.ok === true, code: typeof e.code === 'string' ? e.code.slice(0, 40) : '' })),
    lastError: isObject(raw.lastError) && typeof raw.lastError.code === 'string' && msOrNull(raw.lastError.at)
      ? {
        code: raw.lastError.code.slice(0, 40),
        at: raw.lastError.at,
        detail: typeof raw.lastError.detail === 'string' ? raw.lastError.detail.replace(/[^A-Z0-9_]/gi, '').slice(0, 48) : '',
      }
      : null,
  };
}

/**
 * Regla de categorización: si el campo del movimiento cumple la condición, se le asigna una
 * categoría o se convierte en transferencia a una cuenta (p. ej. «cajero» → Efectivo).
 */
export function normalizeRule(raw) {
  if (!isObject(raw)) fail('Regla no válida.');
  const value = foldText(cleanText(raw.value, LIMITS.ruleValue));
  if (value.length < 2) fail('La regla necesita un texto de al menos 2 caracteres.');
  const rule = {
    id: requireId(raw.id, 'Regla'),
    field: pick(raw.field, RULE_FIELDS, 'text'),
    op: pick(raw.op, RULE_OPS, 'contains'),
    value,
    origin: raw.origin === 'learned' ? 'learned' : 'user',
    active: raw.active !== false,
  };
  if (isId(raw.toAccountId)) rule.toAccountId = raw.toAccountId;
  else rule.categoryId = requireId(raw.categoryId, 'Regla');
  return rule;
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
  const source = normalizeSource(raw.source);
  if (source) movement.source = source;
  // Una transferencia entre dos cuentas importadas guarda también el apunte de la cuenta destino.
  const source2 = movement.type === 'transfer' ? normalizeSource(raw.source2) : null;
  if (source2) movement.source2 = source2;
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
    // Sincronización bancaria automática al abrir la app (respetando el límite diario).
    autoSync: s.autoSync !== false,
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
  if (!READABLE_VERSIONS.includes(raw.version)) {
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

  const connections = collect(raw.connections, LIMITS.connections, 'Conexiones bancarias', normalizeConnection);
  const connectionIds = new Set(connections.map((c) => c.id));
  const accounts = collect(raw.accounts, LIMITS.accounts, 'Cuentas', normalizeAccount);
  for (const a of accounts) {
    if (a.bank?.connectionId && !connectionIds.has(a.bank.connectionId)) {
      a.bank.connectionId = null; // el banco se desconectó: la cuenta queda como manual
      a.bank.externalId = null;
    }
  }
  const categories = collect(raw.categories, LIMITS.categories, 'Categorías', normalizeCategory);
  {
    const byId = new Map(categories.map((c) => [c.id, c]));
    for (const c of categories) {
      const parent = c.parentId ? byId.get(c.parentId) : null;
      // Un solo nivel y del mismo tipo; si no, se queda como categoría principal.
      if (c.parentId && (!parent || parent.kind !== c.kind || parent.parentId)) delete c.parentId;
    }
  }
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

  const rules = collect(raw.rules, LIMITS.rules, 'Reglas', (item) => {
    const r = normalizeRule(item);
    if (r.categoryId && !categoryKind.has(r.categoryId)) fail('Regla: la categoría no existe.');
    if (r.toAccountId && !accountIds.has(r.toAccountId)) fail('Regla: la cuenta no existe.');
    return r;
  });

  const settings = normalizeSettings(raw.settings);
  if (settings.lastAccountId && !accountIds.has(settings.lastAccountId)) settings.lastAccountId = null;

  const byOrder = (a, b) => a.order - b.order;
  accounts.sort(byOrder).forEach((a, i) => { a.order = i; });
  categories.sort(byOrder).forEach((c, i) => { c.order = i; });

  return {
    data: { version: SCHEMA_VERSION, settings, accounts, categories, debts, budgets, recurring, movements, connections, rules },
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
    connections: [],
    rules: [],
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
