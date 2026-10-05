// Estado en memoria (ya descifrado), operaciones que lo modifican y guardado cifrado en segundo plano.
// Las vistas leen con getState()/derived() y se suscriben a los cambios; nunca tocan el estado
// directamente. Cada operación valida su entrada con los normalizadores del modelo.

import * as vault from './vault.js';
import { newId } from './ids.js';
import { todayISO } from './dates.js';
import {
  CORE_BUCKET, LIMITS, ValidationError, allBucketKeys, buildBucket, mergeBuckets, movementBucket, isBucketKey,
  normalizeAccount, normalizeBudget, normalizeCategory, normalizeData, normalizeDebt,
  normalizeMovement, normalizeRecurring, normalizeSettings,
} from './model.js';
import { computeBalances, createDerived } from './finance.js';
import { dueOccurrences, planRecurringUpdate } from './recurring.js';

let state = null;
let rev = 0;
let derivedCache = null;
const listeners = new Set();
const dirty = new Set();
let saving = null;
let saveErrorHandler = () => {};
let generation = 0; // cambia al descargar los datos (bloqueo): invalida operaciones en curso

export const getState = () => state;
export const isLoaded = () => state !== null;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onSaveError(handler) {
  saveErrorHandler = handler;
}

/** Cálculos derivados del estado actual (se recalculan solo cuando cambia algo). */
export function derived() {
  if (!derivedCache || derivedCache.rev !== rev) derivedCache = { rev, value: createDerived(state) };
  return derivedCache.value;
}

// --- Carga, descarga y guardado ---------------------------------------------------------------

export function setState(data) {
  state = data;
  rev += 1;
  dirty.clear();
  derivedCache = null;
}

export function unload() {
  generation += 1;
  setState(null);
}

/** Carga los bloques descifrados. Devuelve cuántos elementos dañados se descartaron. */
export function loadFromBuckets(buckets) {
  const { data, dropped } = normalizeData(mergeBuckets(buckets), { strict: false });
  setState(data);
  if (dropped > 0) {
    // Reescribe lo reparado y borra los bloques que se quedaron vacíos (si no, se repetiría).
    for (const key of [...allBucketKeys(state), ...buckets.keys()]) if (isBucketKey(key)) dirty.add(key);
    save();
  }
  return dropped;
}

/** Todos los bloques de un conjunto de datos (crear la caja fuerte o restaurar una copia). */
export function allBuckets(data = state) {
  return new Map([...allBucketKeys(data)].map((key) => [key, buildBucket(data, key)]));
}

function bucketOrNull(key) {
  const bucket = buildBucket(state, key);
  return key !== CORE_BUCKET && bucket.movements.length === 0 ? null : bucket;
}

/** Guarda los bloques modificados. Las escrituras se encadenan y nunca se solapan. */
export function save() {
  if (!saving) {
    saving = (async () => {
      try {
        while (dirty.size > 0 && state) {
          const keys = [...dirty];
          dirty.clear();
          const changes = new Map(keys.map((key) => [key, bucketOrNull(key)]));
          try {
            await vault.saveBuckets(changes);
          } catch (error) {
            for (const key of keys) dirty.add(key);
            throw error;
          }
        }
      } finally {
        saving = null;
      }
    })();
    saving.catch((error) => saveErrorHandler(error));
  }
  return saving;
}

/** Espera a que todo lo pendiente esté guardado (antes de bloquear la app, por ejemplo). */
export async function flush() {
  if (saving) await saving;
  if (dirty.size > 0 && state) await save();
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error(error);
    }
  }
}

function commit(...keys) {
  for (const key of keys) dirty.add(key);
  rev += 1;
  save();
  notify();
}

// --- Utilidades internas ----------------------------------------------------------------------

function requireState() {
  if (!state) throw new Error('Los datos están bloqueados.');
  return state;
}

const byId = (list, id) => list.find((item) => item.id === id);

function mustFind(list, id, what) {
  const item = byId(list, id);
  if (!item) throw new ValidationError(`${what} no existe.`);
  return item;
}

function ensureRoom(list, limit, message) {
  if (list.length >= limit) throw new ValidationError(message);
}

/** Comprueba que un movimiento (o plantilla) apunta a cuentas, categorías y deudas existentes. */
function checkRefs(m) {
  const s = state;
  if (m.accountId !== null && !byId(s.accounts, m.accountId)) throw new ValidationError('La cuenta no existe.');
  if (m.type === 'transfer' && !byId(s.accounts, m.toAccountId)) throw new ValidationError('La cuenta de destino no existe.');
  if (m.type === 'expense' || m.type === 'income') {
    const category = byId(s.categories, m.categoryId);
    if (!category || category.kind !== m.type) throw new ValidationError('Elige una categoría.');
  }
  if (m.type === 'debt' && !byId(s.debts, m.debtId)) throw new ValidationError('La deuda no existe.');
  return m;
}

/** Reordena los elementos de `ids` dentro de las posiciones que ya ocupan en la lista. */
function applyOrder(list, ids) {
  const sorted = [...list].sort((a, b) => a.order - b.order);
  const wanted = ids.map((id) => byId(list, id)).filter(Boolean);
  const wantedSet = new Set(wanted);
  let k = 0;
  sorted.map((item) => (wantedSet.has(item) ? wanted[k++] : item)).forEach((item, i) => {
    item.order = i;
  });
  list.sort((a, b) => a.order - b.order);
}

function reindex(list) {
  list.forEach((item, i) => {
    item.order = i;
  });
}

function insertMovement(input, extra = {}) {
  ensureRoom(state.movements, LIMITS.movements, 'Has alcanzado el máximo de movimientos.');
  const movement = checkRefs(normalizeMovement({ ...input, id: newId(), ts: Date.now(), ...extra }));
  state.movements.push(movement);
  return movement;
}

// --- Cuentas ----------------------------------------------------------------------------------

export function addAccount(input) {
  const s = requireState();
  ensureRoom(s.accounts, LIMITS.accounts, `Puedes tener como máximo ${LIMITS.accounts} cuentas.`);
  const account = normalizeAccount({ ...input, id: newId(), order: s.accounts.length });
  s.accounts.push(account);
  commit(CORE_BUCKET);
  return account;
}

export function updateAccount(id, input) {
  const s = requireState();
  const current = mustFind(s.accounts, id, 'La cuenta');
  const next = normalizeAccount({ ...current, ...input, id, order: current.order });
  s.accounts[s.accounts.indexOf(current)] = next;
  commit(CORE_BUCKET);
  return next;
}

/** Cambia el saldo actual de una cuenta ajustando su saldo inicial (el historial no cambia). */
export function setAccountBalance(id, target) {
  const s = requireState();
  const account = mustFind(s.accounts, id, 'La cuenta');
  const balance = computeBalances(s).get(id) ?? 0;
  return updateAccount(id, { initial: account.initial + (target - balance) });
}

export function reorderAccounts(ids) {
  applyOrder(requireState().accounts, ids);
  commit(CORE_BUCKET);
}

/** Movimientos y programados que se verían afectados al borrar una cuenta. */
export function accountUsage(id) {
  const s = requireState();
  return {
    movements: s.movements.filter((m) => m.accountId === id || m.toAccountId === id).length,
    recurring: s.recurring.filter((r) => r.template.accountId === id || r.template.toAccountId === id).length,
  };
}

/**
 * Borra una cuenta con sus gastos, ingresos, transferencias y programados.
 * Los pagos de deudas se conservan (sin cuenta) para no alterar lo que queda por pagar.
 */
export function deleteAccount(id) {
  const s = requireState();
  mustFind(s.accounts, id, 'La cuenta');
  const keys = new Set([CORE_BUCKET]);
  s.movements = s.movements.filter((m) => {
    if (m.type === 'debt') {
      if (m.accountId === id) {
        m.accountId = null;
        keys.add(movementBucket(m.date));
      }
      return true;
    }
    const uses = m.accountId === id || m.toAccountId === id;
    if (uses) keys.add(movementBucket(m.date));
    return !uses;
  });
  s.recurring = s.recurring.filter((r) => {
    if (r.template.type === 'debt') {
      if (r.template.accountId === id) r.template.accountId = null;
      return true;
    }
    return r.template.accountId !== id && r.template.toAccountId !== id;
  });
  s.accounts = s.accounts.filter((a) => a.id !== id);
  reindex(s.accounts);
  if (s.settings.lastAccountId === id) s.settings.lastAccountId = null;
  commit(...keys);
}

// --- Categorías -------------------------------------------------------------------------------

const activeOfKind = (s, kind) => s.categories.filter((c) => c.kind === kind && !c.archived);

export function addCategory(input) {
  const s = requireState();
  ensureRoom(s.categories, LIMITS.categories, `Puedes tener como máximo ${LIMITS.categories} categorías.`);
  const category = normalizeCategory({ ...input, id: newId(), archived: false, order: s.categories.length });
  s.categories.push(category);
  commit(CORE_BUCKET);
  return category;
}

export function updateCategory(id, input) {
  const s = requireState();
  const current = mustFind(s.categories, id, 'La categoría');
  const next = normalizeCategory({ ...current, ...input, id, kind: current.kind, order: current.order });
  if (next.archived && !current.archived && activeOfKind(s, current.kind).length === 1) {
    throw new ValidationError('Debe quedar al menos una categoría activa de este tipo.');
  }
  s.categories[s.categories.indexOf(current)] = next;
  commit(CORE_BUCKET);
  return next;
}

export function reorderCategories(ids) {
  applyOrder(requireState().categories, ids);
  commit(CORE_BUCKET);
}

export function categoryUsage(id) {
  const s = requireState();
  return {
    movements: s.movements.filter((m) => m.categoryId === id).length,
    recurring: s.recurring.filter((r) => r.template.categoryId === id).length,
    budget: s.budgets.some((b) => b.categoryId === id),
  };
}

/** Borra una categoría pasando sus movimientos y programados a `replacementId`. */
export function deleteCategory(id, replacementId = null) {
  const s = requireState();
  const category = mustFind(s.categories, id, 'La categoría');
  if (s.categories.filter((c) => c.kind === category.kind).length === 1) {
    throw new ValidationError('Debe quedar al menos una categoría de este tipo.');
  }
  if (!category.archived && activeOfKind(s, category.kind).length === 1) {
    throw new ValidationError('Debe quedar al menos una categoría activa de este tipo.');
  }
  const usage = categoryUsage(id);
  let replacement = null;
  if (usage.movements > 0 || usage.recurring > 0) {
    replacement = mustFind(s.categories, replacementId, 'La categoría de destino');
    if (replacement.id === id || replacement.kind !== category.kind) {
      throw new ValidationError('Elige otra categoría del mismo tipo.');
    }
  }
  const keys = new Set([CORE_BUCKET]);
  for (const m of s.movements) {
    if (m.categoryId === id) {
      m.categoryId = replacement.id;
      keys.add(movementBucket(m.date));
    }
  }
  for (const r of s.recurring) if (r.template.categoryId === id) r.template.categoryId = replacement.id;
  s.budgets = s.budgets.filter((b) => b.categoryId !== id);
  s.categories = s.categories.filter((c) => c.id !== id);
  reindex(s.categories);
  commit(...keys);
}

// --- Movimientos ------------------------------------------------------------------------------

export function addMovement(input) {
  const s = requireState();
  const movement = insertMovement(input);
  const keys = [movementBucket(movement.date)];
  if (movement.type !== 'debt' && s.settings.lastAccountId !== movement.accountId) {
    s.settings.lastAccountId = movement.accountId;
    keys.push(CORE_BUCKET);
  }
  commit(...keys);
  return movement;
}

export function updateMovement(id, input) {
  const s = requireState();
  const current = mustFind(s.movements, id, 'El movimiento');
  const next = checkRefs(normalizeMovement({ ...current, ...input, id, ts: current.ts, recurringId: current.recurringId }));
  s.movements[s.movements.indexOf(current)] = next;
  commit(movementBucket(current.date), movementBucket(next.date));
  return next;
}

/** Borra un movimiento y lo devuelve (para poder deshacer). */
export function deleteMovement(id) {
  const s = requireState();
  const index = s.movements.findIndex((m) => m.id === id);
  if (index < 0) return null;
  const [removed] = s.movements.splice(index, 1);
  commit(movementBucket(removed.date));
  return removed;
}

export function restoreMovement(movement) {
  const s = requireState();
  if (byId(s.movements, movement.id)) return;
  ensureRoom(s.movements, LIMITS.movements, 'Has alcanzado el máximo de movimientos.');
  s.movements.push(checkRefs(normalizeMovement(movement)));
  commit(movementBucket(movement.date));
}

// --- Deudas -----------------------------------------------------------------------------------

/**
 * Crea una deuda y, si se indica, su importe inicial como primer movimiento.
 * initial: { amount, date, accountId | null, note }
 */
export function addDebt(input, initial = null) {
  const s = requireState();
  ensureRoom(s.debts, LIMITS.debts, `Puedes tener como máximo ${LIMITS.debts} deudas.`);
  const debt = normalizeDebt({ ...input, id: newId() });
  s.debts.push(debt);
  const keys = [CORE_BUCKET];
  if (initial) {
    try {
      keys.push(movementBucket(insertMovement({ ...initial, type: 'debt', debtId: debt.id, flow: 'add' }).date));
    } catch (error) {
      s.debts.pop(); // todo o nada
      throw error;
    }
  }
  commit(...keys);
  return debt;
}

export function updateDebt(id, input) {
  const s = requireState();
  const current = mustFind(s.debts, id, 'La deuda');
  const next = normalizeDebt({ ...current, ...input, id, kind: current.kind });
  s.debts[s.debts.indexOf(current)] = next;
  commit(CORE_BUCKET);
  return next;
}

/** Borra una deuda con todos sus movimientos y programados. */
export function deleteDebt(id) {
  const s = requireState();
  mustFind(s.debts, id, 'La deuda');
  const keys = new Set([CORE_BUCKET]);
  s.movements = s.movements.filter((m) => {
    const remove = m.type === 'debt' && m.debtId === id;
    if (remove) keys.add(movementBucket(m.date));
    return !remove;
  });
  s.recurring = s.recurring.filter((r) => r.template.debtId !== id);
  s.debts = s.debts.filter((d) => d.id !== id);
  commit(...keys);
}

// --- Presupuestos -----------------------------------------------------------------------------

/** Fija (o quita, con amount = null) el presupuesto mensual de una categoría o el total (null). */
export function setBudget(categoryId, amount) {
  const s = requireState();
  if (categoryId !== null && mustFind(s.categories, categoryId, 'La categoría').kind !== 'expense') {
    throw new ValidationError('Los presupuestos son para categorías de gasto.');
  }
  const existing = s.budgets.find((b) => b.categoryId === categoryId);
  if (amount === null) {
    if (existing) s.budgets = s.budgets.filter((b) => b !== existing);
  } else if (existing) {
    s.budgets[s.budgets.indexOf(existing)] = normalizeBudget({ ...existing, amount });
  } else {
    ensureRoom(s.budgets, LIMITS.budgets, 'Has alcanzado el máximo de presupuestos.');
    s.budgets.push(normalizeBudget({ id: newId(), categoryId, amount }));
  }
  commit(CORE_BUCKET);
}

// --- Programados (recurrentes) ----------------------------------------------------------------

/** Crea los movimientos programados pendientes hasta `today`. Devuelve claves de bloque y número. */
function generateDue(today) {
  const keys = new Set();
  const advanced = new Map();
  let changed = false;
  for (const { rule, date } of dueOccurrences(state.recurring, today)) {
    if (!rule.active) continue; // desactivada tras un fallo en esta misma pasada
    try {
      keys.add(movementBucket(insertMovement({ ...rule.template, date }, { recurringId: rule.id }).date));
      advanced.set(rule, (advanced.get(rule) ?? 0) + 1);
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      rule.active = false; // plantilla inválida o límite alcanzado: se pausa en lugar de fallar en bucle
      changed = true;
    }
  }
  for (const [rule, count] of advanced) rule.index += count;
  if (changed || advanced.size > 0) keys.add(CORE_BUCKET);
  return { keys, created: [...advanced.values()].reduce((a, b) => a + b, 0) };
}

/** Ejecuta los programados pendientes. Devuelve cuántos movimientos se han creado. */
export function runRecurring(today = todayISO()) {
  requireState();
  const { keys, created } = generateDue(today);
  if (keys.size > 0) commit(...keys);
  return created;
}

/**
 * input: { active, frequency, interval, nextDate, endDate, template }.
 * `nextDate` es la primera fecha en la que se creará el movimiento.
 */
export function addRecurring(input, today = todayISO()) {
  const s = requireState();
  ensureRoom(s.recurring, LIMITS.recurring, 'Has alcanzado el máximo de movimientos programados.');
  const rule = normalizeRecurring({ ...input, id: newId(), startDate: input.nextDate, index: 0, anchorDay: null });
  checkRefs(rule.template);
  s.recurring.push(rule);
  const { keys, created } = generateDue(today);
  commit(CORE_BUCKET, ...keys);
  return { rule, created };
}

/** Guarda la edición de una regla (reanclaje y reanudación según planRecurringUpdate). */
export function updateRecurring(id, input, today = todayISO()) {
  const s = requireState();
  const current = mustFind(s.recurring, id, 'El movimiento programado');
  const next = normalizeRecurring({ ...planRecurringUpdate(current, input, today), id });
  checkRefs(next.template);
  s.recurring[s.recurring.indexOf(current)] = next;
  const { keys, created } = generateDue(today);
  commit(CORE_BUCKET, ...keys);
  return { rule: next, created };
}

/** Borra la regla; los movimientos ya creados se conservan como movimientos normales. */
export function deleteRecurring(id) {
  const s = requireState();
  mustFind(s.recurring, id, 'El movimiento programado');
  const keys = new Set([CORE_BUCKET]);
  for (const m of s.movements) {
    if (m.recurringId === id) {
      delete m.recurringId;
      keys.add(movementBucket(m.date));
    }
  }
  s.recurring = s.recurring.filter((r) => r.id !== id);
  commit(...keys);
}

// --- Ajustes y restauración -------------------------------------------------------------------

export function updateSettings(patch) {
  const s = requireState();
  s.settings = normalizeSettings({ ...s.settings, ...patch });
  commit(CORE_BUCKET);
}

/** Sustituye todos los datos por los de una copia ya validada (modo estricto). */
export async function replaceAll(data) {
  const previous = requireState();
  const pending = new Set(dirty); // cambios aún sin guardar: se conservan si la restauración falla
  if (saving) await saving.catch(() => {});
  const session = generation;
  setState(data);
  try {
    await vault.replaceBuckets(allBuckets(data)); // borra y escribe todo en una sola transacción
  } catch (error) {
    if (session === generation) { // si se bloqueó mientras tanto, no se recarga nada
      setState(previous);
      for (const key of pending) dirty.add(key);
      notify();
    }
    throw error;
  }
  notify();
}
