// Estado en memoria (ya descifrado), operaciones que lo modifican y guardado cifrado en segundo plano.
// Las vistas leen con getState()/derived() y se suscriben a los cambios; nunca tocan el estado
// directamente. Cada operación valida su entrada con los normalizadores del modelo.

import * as vault from './vault.js';
import { newId } from './ids.js';
import { todayISO } from './dates.js';
import {
  CORE_BUCKET, LIMITS, ValidationError, allBucketKeys, buildBucket, mergeBuckets, movementBucket, isBucketKey,
  normalizeAccount, normalizeBudget, normalizeCategory, normalizeData, normalizeDebt,
  normalizeMovement, normalizeRecurring, normalizeSettings, normalizeConnection, normalizeRule,
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
// Secretos del banco (clave de la app de Open Banking, sesiones). Van en su propio bloque cifrado,
// fuera de `state`: no se muestran, no se exportan y no entran en las copias de seguridad.
let secrets = null;

export const getState = () => state;
/** Cambia en cada bloqueo: una operación lenta (sincronizar) comprueba que sigue en la misma sesión. */
export const sessionGeneration = () => generation;
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
  lastImport = null;
  secrets = null;
  setState(null);
}

/** Copia de los secretos del banco (o null). Solo para core/bank/. */
export const getSecrets = () => (secrets ? structuredClone(secrets) : null);

/** Guarda los secretos del banco cifrados (null los borra). Exige caja fuerte con contraseña. */
export async function setSecrets(value) {
  requireState();
  if (value !== null && (await vault.secretKind()) !== 'password') {
    throw new ValidationError('Para conectar un banco, protege Nummo con una contraseña (Más → Seguridad).');
  }
  secrets = value === null ? null : structuredClone(value);
  dirty.add(vault.SECRETS_BUCKET);
  await save(); // misma cola que el resto de escrituras: nunca se solapan
}

/** Carga los bloques descifrados. Devuelve cuántos elementos dañados se descartaron. */
export function loadFromBuckets(buckets) {
  const { data, dropped } = normalizeData(mergeBuckets(buckets), { strict: false });
  setState(data);
  const stored = buckets.get(vault.SECRETS_BUCKET);
  secrets = stored && typeof stored === 'object' ? stored : null;
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
          const changes = new Map(keys.map((key) => [key, key === vault.SECRETS_BUCKET ? secrets : bucketOrNull(key)]));
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
/** Qué pasaría al borrar una cuenta (para explicarlo antes de confirmar). */
export function accountUsage(id) {
  const s = requireState();
  const uses = (m) => m.accountId === id || m.toAccountId === id;
  return {
    movements: s.movements.filter((m) => m.type !== 'debt' && uses(m)).length, // se borran
    transfers: s.movements.filter((m) => m.type === 'transfer' && uses(m)).length,
    debtMovements: s.movements.filter((m) => m.type === 'debt' && m.accountId === id).length, // se conservan sin cuenta
    recurring: s.recurring.filter((r) => r.template.type !== 'debt' && uses(r.template)).length,
  };
}

/**
 * Borra una cuenta con sus gastos, ingresos, transferencias y programados.
 * - Los pagos de deudas se conservan (sin cuenta) para no alterar lo que queda por pagar.
 * - Las otras cuentas de sus transferencias conservan su saldo actual: se compensa su saldo de
 *   partida con lo que aportaban esas transferencias (si no, dejarían de cuadrar con el banco).
 */
export function deleteAccount(id) {
  const s = requireState();
  mustFind(s.accounts, id, 'La cuenta');
  const compensation = new Map();
  for (const m of s.movements) {
    if (m.type !== 'transfer' || (m.accountId !== id && m.toAccountId !== id)) continue;
    const other = m.accountId === id ? m.toAccountId : m.accountId;
    compensation.set(other, (compensation.get(other) ?? 0) + (other === m.toAccountId ? m.amount : -m.amount));
  }
  // Se valida todo antes de cambiar nada (todo o nada).
  const adjusted = [...compensation].map(([accountId, delta]) => {
    const account = mustFind(s.accounts, accountId, 'La cuenta');
    return normalizeAccount({ ...account, initial: account.initial + delta });
  });
  const keys = new Set([CORE_BUCKET]);
  for (const account of adjusted) s.accounts[s.accounts.findIndex((a) => a.id === account.id)] = account;
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
  s.rules = s.rules.filter((r) => r.toAccountId !== id);
  reindex(s.accounts);
  if (s.settings.lastAccountId === id) s.settings.lastAccountId = null;
  commit(...keys);
}

// --- Categorías -------------------------------------------------------------------------------

const activeOfKind = (s, kind) => s.categories.filter((c) => c.kind === kind && !c.archived);

/** Subcategorías: un solo nivel, mismo tipo y sin hijos propios. */
function checkParent(s, category) {
  if (!category.parentId) return category;
  const parent = byId(s.categories, category.parentId);
  if (!parent || parent.kind !== category.kind || parent.parentId || parent.id === category.id) {
    throw new ValidationError('Elige una categoría principal del mismo tipo.');
  }
  if (s.categories.some((c) => c.parentId === category.id)) {
    throw new ValidationError('Una categoría con subcategorías no puede ser subcategoría.');
  }
  return category;
}

export function addCategory(input) {
  const s = requireState();
  ensureRoom(s.categories, LIMITS.categories, `Puedes tener como máximo ${LIMITS.categories} categorías.`);
  const category = checkParent(s, normalizeCategory({ ...input, id: newId(), archived: false, order: s.categories.length }));
  s.categories.push(category);
  commit(CORE_BUCKET);
  return category;
}

export function updateCategory(id, input) {
  const s = requireState();
  const current = mustFind(s.categories, id, 'La categoría');
  const next = checkParent(s, normalizeCategory({ ...current, ...input, id, kind: current.kind, order: current.order }));
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
  // Las reglas pasan a la categoría de destino (o se quitan) y las subcategorías suben de nivel.
  s.rules = s.rules.flatMap((r) => (r.categoryId !== id ? [r] : replacement ? [{ ...r, categoryId: replacement.id }] : []));
  s.categories = s.categories.filter((c) => c.id !== id).map((c) => {
    if (c.parentId !== id) return c;
    const { parentId, ...rest } = c;
    return rest;
  });
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
  // El tipo se puede corregir: los efectos en las cuentas se calculan a partir de él.
  const next = normalizeDebt({ ...current, ...input, id });
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

// --- Importación (banco o archivo) ------------------------------------------------------------

let lastImport = null; // para «Deshacer» justo después de importar (solo en memoria)

/**
 * Aplica un plan de import/plan.js de una sola vez: si algo no valida, no cambia nada.
 * opts: { accountId, batch, bank?: datos de banco a fusionar en la cuenta,
 *         balance?: { amount, date } saldo del banco, followBalance?: ajustar el saldo de la cuenta }.
 * Devuelve { batch, stats }.
 */
export function applyImport(plan, { accountId, bank = null, balance = null, followBalance = true, batch = null, excludePending = false } = {}) {
  const s = requireState();
  const account = mustFind(s.accounts, accountId, 'La cuenta');
  if (s.movements.length + plan.add.length - plan.remove.length > LIMITS.movements) {
    throw new ValidationError('Has alcanzado el máximo de movimientos.');
  }
  const removeIds = new Set(plan.remove.map((m) => m.id));
  const replaced = new Map(plan.update.map((u) => [u.before.id, u.after]));
  const addIds = new Set(plan.add.map((m) => m.id));
  const keys = new Set([CORE_BUCKET]);
  const next = [];
  // Validación completa antes de tocar el estado (todo o nada).
  for (const m of s.movements) {
    if (removeIds.has(m.id)) {
      keys.add(movementBucket(m.date));
      continue;
    }
    const after = replaced.get(m.id);
    if (after) {
      const checked = checkRefs(normalizeMovement(after));
      keys.add(movementBucket(m.date));
      keys.add(movementBucket(checked.date));
      next.push(checked);
    } else {
      next.push(m);
    }
  }
  const existing = new Set(next.map((m) => m.id));
  for (const m of plan.add) {
    if (existing.has(m.id)) throw new ValidationError('Movimiento repetido en la importación.');
    const checked = checkRefs(normalizeMovement(m));
    existing.add(checked.id);
    keys.add(movementBucket(checked.date));
    next.push(checked);
  }
  let nextAccount = account;
  if (bank) nextAccount = normalizeAccount({ ...account, bank: { ...(account.bank ?? {}), ...bank } });
  const follow = followBalance && (nextAccount.bank?.followBalance ?? true);
  if (balance && follow && !(nextAccount.bank?.balanceAt && nextAccount.bank.balanceAt > balance.date)) {
    // El saldo de la cuenta pasa a coincidir con el del banco en esa fecha (se ajusta el inicial).
    // El saldo contable del banco no incluye lo pendiente: con excludePending se compara sin ello,
    // así en Nummo el saldo queda como «contable + pendientes» (lo que de verdad se puede gastar).
    const isPendingHere = (m) => (m.accountId === accountId && m.source?.status === 'pending')
      || (m.toAccountId === accountId && m.source2?.status === 'pending');
    const tentative = {
      ...s,
      movements: excludePending ? next.filter((m) => !isPendingHere(m)) : next,
      accounts: s.accounts.map((a) => (a.id === accountId ? nextAccount : a)),
    };
    const computed = computeBalances(tentative, balance.date).get(accountId) ?? 0;
    nextAccount = normalizeAccount({
      ...nextAccount,
      initial: nextAccount.initial + (balance.amount - computed),
      bank: { ...(nextAccount.bank ?? {}), bankBalance: balance.amount, balanceAt: balance.date },
    });
  }
  lastImport = {
    batch,
    accountId,
    prevAccount: account,
    added: [...addIds],
    updated: plan.update.map((u) => u.before),
    removed: plan.remove,
  };
  s.movements = next;
  s.accounts = s.accounts.map((a) => (a.id === accountId ? nextAccount : a));
  commit(...keys);
  return { batch, stats: plan.stats };
}

/** ¿Se puede deshacer esta importación? (solo la última y mientras la app sigue abierta) */
export const canUndoImport = (batch) => lastImport !== null && lastImport.batch === batch;

/** Deshace la última importación: quita lo añadido y devuelve lo cambiado a como estaba. */
export function undoImport(batch) {
  const s = requireState();
  if (!canUndoImport(batch)) return false;
  const added = new Set(lastImport.added);
  const restore = new Map(lastImport.updated.map((m) => [m.id, m]));
  const keys = new Set([CORE_BUCKET]);
  const next = [];
  for (const m of s.movements) {
    if (added.has(m.id)) {
      keys.add(movementBucket(m.date));
      continue;
    }
    const before = restore.get(m.id);
    if (before) {
      keys.add(movementBucket(m.date));
      keys.add(movementBucket(before.date));
      next.push(before);
    } else {
      next.push(m);
    }
  }
  for (const m of lastImport.removed) {
    keys.add(movementBucket(m.date));
    next.push(m);
  }
  const { accountId, prevAccount } = lastImport;
  s.movements = next;
  s.accounts = s.accounts.map((a) => (a.id === accountId ? prevAccount : a));
  lastImport = null;
  commit(...keys);
  return true;
}

/** Datos de banco de una cuenta (IBAN enmascarado y su hash, conexión…). null los quita. */
export function setAccountBank(id, bank) {
  const s = requireState();
  const current = mustFind(s.accounts, id, 'La cuenta');
  const { bank: _old, ...rest } = current;
  const next = bank === null ? normalizeAccount(rest) : normalizeAccount({ ...current, bank: { ...(current.bank ?? {}), ...bank } });
  s.accounts[s.accounts.indexOf(current)] = next;
  commit(CORE_BUCKET);
  return next;
}

/** Une un gasto y un ingreso de dos cuentas propias en una sola transferencia. */
export function mergeTransfer(expenseId, incomeId) {
  const s = requireState();
  const e = mustFind(s.movements, expenseId, 'El movimiento');
  const i = mustFind(s.movements, incomeId, 'El movimiento');
  if (e.type !== 'expense' || i.type !== 'income' || e.amount !== i.amount || e.accountId === i.accountId) {
    throw new ValidationError('Estos movimientos no forman una transferencia.');
  }
  const merged = checkRefs(normalizeMovement({
    id: e.id, date: e.date, type: 'transfer', amount: e.amount, accountId: e.accountId, toAccountId: i.accountId,
    note: e.note || i.note, ts: e.ts, source: e.source, source2: i.source,
  }));
  s.movements = s.movements.filter((m) => m.id !== i.id).map((m) => (m.id === e.id ? merged : m));
  commit(movementBucket(e.date), movementBucket(i.date));
  return merged;
}

/**
 * Vuelve a aplicar las reglas a los movimientos importados cuya categoría no eligió la persona.
 * decide(m) devuelve el resultado de import/rules.js categorize(). Devuelve cuántos cambian.
 */
export function reapplyRules(decide) {
  const s = requireState();
  const keys = new Set();
  let changed = 0;
  s.movements = s.movements.map((m) => {
    if ((m.type !== 'expense' && m.type !== 'income') || !m.source || m.source.cat === 'user') return m;
    const decision = decide(m);
    if (!decision || decision.type !== m.type || !decision.categoryId || decision.categoryId === m.categoryId) return m;
    changed += 1;
    keys.add(movementBucket(m.date));
    return { ...m, categoryId: decision.categoryId, source: { ...m.source, cat: decision.cat } };
  });
  if (changed) commit(...keys);
  return changed;
}

// --- Reglas de categorización -----------------------------------------------------------------

function checkRuleRefs(rule) {
  const s = state;
  if (rule.categoryId && !byId(s.categories, rule.categoryId)) throw new ValidationError('Elige una categoría.');
  if (rule.toAccountId && !byId(s.accounts, rule.toAccountId)) throw new ValidationError('Elige una cuenta.');
  return rule;
}

/** Crea una regla; si ya hay una igual (mismo campo, condición y texto), la sustituye. */
export function addRule(input) {
  const s = requireState();
  const rule = checkRuleRefs(normalizeRule({ ...input, id: newId() }));
  const same = s.rules.find((r) => r.field === rule.field && r.op === rule.op && r.value === rule.value);
  if (same) {
    const replaced = { ...rule, id: same.id };
    s.rules[s.rules.indexOf(same)] = replaced;
    commit(CORE_BUCKET);
    return replaced;
  }
  ensureRoom(s.rules, LIMITS.rules, 'Has alcanzado el máximo de reglas.');
  s.rules.push(rule);
  commit(CORE_BUCKET);
  return rule;
}

export function updateRule(id, input) {
  const s = requireState();
  const current = mustFind(s.rules, id, 'La regla');
  const merged = { ...current, ...input, id };
  if (input.categoryId) delete merged.toAccountId;
  if (input.toAccountId) delete merged.categoryId;
  const next = checkRuleRefs(normalizeRule(merged));
  s.rules[s.rules.indexOf(current)] = next;
  commit(CORE_BUCKET);
  return next;
}

export function deleteRule(id) {
  const s = requireState();
  mustFind(s.rules, id, 'La regla');
  s.rules = s.rules.filter((r) => r.id !== id);
  commit(CORE_BUCKET);
}

// --- Conexiones bancarias ---------------------------------------------------------------------

export function addConnection(input) {
  const s = requireState();
  ensureRoom(s.connections, LIMITS.connections, 'Has alcanzado el máximo de bancos conectados.');
  const connection = normalizeConnection({ createdAt: Date.now(), ...input, id: input.id ?? newId() });
  s.connections.push(connection);
  commit(CORE_BUCKET);
  return connection;
}

export function updateConnection(id, patch) {
  const s = requireState();
  const current = mustFind(s.connections, id, 'El banco');
  const next = normalizeConnection({ ...current, ...patch, id });
  s.connections[s.connections.indexOf(current)] = next;
  commit(CORE_BUCKET);
  return next;
}

/** Quita un banco. Sus cuentas quedan como cuentas manuales; opcionalmente se borran sus apuntes. */
export function removeConnection(id, { deleteMovements = false } = {}) {
  const s = requireState();
  mustFind(s.connections, id, 'El banco');
  const keys = new Set([CORE_BUCKET]);
  const linked = new Set(s.accounts.filter((a) => a.bank?.connectionId === id).map((a) => a.id));
  s.accounts = s.accounts.map((a) => (linked.has(a.id)
    ? normalizeAccount({ ...a, bank: { ...a.bank, connectionId: null, externalId: null } })
    : a));
  if (deleteMovements) {
    s.movements = s.movements.filter((m) => {
      const fromBank = (m.source?.kind === 'bank' && linked.has(m.accountId))
        || (m.source2?.kind === 'bank' && linked.has(m.toAccountId));
      if (fromBank) keys.add(movementBucket(m.date));
      return !fromBank;
    });
  }
  s.connections = s.connections.filter((c) => c.id !== id);
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
    const buckets = allBuckets(data);
    if (secrets) buckets.set(vault.SECRETS_BUCKET, secrets); // el acceso al banco no viene en la copia
    await vault.replaceBuckets(buckets); // borra y escribe todo en una sola transacción
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
