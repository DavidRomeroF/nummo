import { test, assert } from './runner.js';
import { sampleState } from './fixtures.js';
import * as idb from '../app/js/core/idb.js';
import * as vault from '../app/js/core/vault.js';
import * as store from '../app/js/core/store.js';
import { MIN_ITERATIONS } from '../app/js/core/crypto.js';
import { ValidationError } from '../app/js/core/model.js';
import { computeBalances, computeDebtTotals } from '../app/js/core/finance.js';

const PIN = '112233';
const isValidation = (e) => e instanceof ValidationError;

async function setup(data = sampleState()) {
  idb.useDatabase('app-dinero-test');
  await idb.deleteDatabase();
  idb.useDatabase('app-dinero-test');
  vault.setIterationsForTests(MIN_ITERATIONS);
  await vault.create(PIN, store.allBuckets(data));
  store.setState(data);
}

/** Guarda, bloquea y vuelve a cargar desde el almacenamiento cifrado. */
async function reload() {
  await store.flush();
  vault.lock();
  store.unload();
  const dropped = store.loadFromBuckets(await vault.unlock(PIN));
  assert.equal(dropped, 0, 'no debe haber datos dañados');
  return store.getState();
}

test('store: los cambios se guardan cifrados y sobreviven a un bloqueo', async () => {
  await setup();
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  const account = store.addAccount({ name: 'Revolut', type: 'card', color: 'purple', initial: 1234 });
  const movement = store.addMovement({ type: 'expense', amount: 999, date: '2027-01-02', accountId: account.id, categoryId: 'catFoodXX', note: 'Pan' });
  unsubscribe();
  assert.equal(notified, 2);
  assert.equal(store.getState().settings.lastAccountId, account.id, 'recuerda la última cuenta usada');
  const state = await reload();
  assert.ok(state.accounts.some((a) => a.name === 'Revolut'));
  assert.equal(state.movements.find((m) => m.id === movement.id).note, 'Pan');
  assert.ok((await idb.entries('vault')).some(([k]) => k === 'mov-2027'), 'bloque del año nuevo');
});

test('store: una operación inválida no cambia nada', async () => {
  await setup();
  const before = JSON.stringify(store.getState());
  assert.throws(() => store.addMovement({ type: 'expense', amount: 100, date: '2026-10-10', accountId: 'accountAAA', categoryId: 'catSalary' }), isValidation);
  assert.throws(() => store.addMovement({ type: 'expense', amount: -1, date: '2026-10-10', accountId: 'accountAAA', categoryId: 'catFoodXX' }), isValidation);
  assert.throws(() => store.addDebt({ kind: 'owe', name: 'X' }, { amount: 100, date: '2026-10-10', accountId: 'noExiste1' }), isValidation);
  assert.equal(JSON.stringify(store.getState()), before);
});

test('store: editar, borrar y deshacer un movimiento (también al cambiar de año)', async () => {
  await setup();
  store.updateMovement('mov00001', { date: '2025-06-01', amount: 7000 });
  let state = await reload();
  assert.equal(state.movements.find((m) => m.id === 'mov00001').date, '2025-06-01');
  const removed = store.deleteMovement('mov00002');
  assert.equal(removed.id, 'mov00002');
  assert.equal(store.deleteMovement('noExiste1'), null);
  store.restoreMovement(removed);
  state = await reload();
  assert.ok(state.movements.some((m) => m.id === 'mov00002'), 'deshacer restaura el movimiento');
});

test('store: ajustar el saldo actual de una cuenta', async () => {
  await setup();
  store.setAccountBalance('accountAAA', 100);
  assert.equal(computeBalances(store.getState()).get('accountAAA'), 100);
});

test('store: borrar una cuenta conserva los pagos de deudas sin cuenta', async () => {
  await setup();
  assert.deepEqual(store.accountUsage('accountAAA'), { movements: 5, recurring: 0 });
  store.deleteAccount('accountAAA');
  const state = await reload();
  assert.ok(!state.accounts.some((a) => a.id === 'accountAAA'));
  assert.ok(!state.movements.some((m) => m.type !== 'debt' && (m.accountId === 'accountAAA' || m.toAccountId === 'accountAAA')));
  assert.equal(state.movements.find((m) => m.id === 'mov00004').accountId, null);
  assert.equal(computeDebtTotals(state).get('debtOweXX').pending, 20000, 'lo pendiente no cambia');
});

test('store: borrar una categoría mueve sus movimientos y quita su presupuesto', async () => {
  await setup();
  assert.throws(() => store.deleteCategory('catFunXXX'), isValidation, 'necesita categoría de destino');
  assert.throws(() => store.deleteCategory('catFunXXX', 'catSalary'), isValidation, 'destino de otro tipo');
  store.deleteCategory('catFunXXX', 'catFoodXX');
  const state = await reload();
  assert.equal(state.movements.find((m) => m.id === 'mov00008').categoryId, 'catFoodXX');
  assert.ok(!state.budgets.some((b) => b.categoryId === 'catFunXXX'));
  assert.throws(() => store.deleteCategory('catSalary'), isValidation, 'debe quedar una categoría de ingresos');
  assert.throws(() => store.updateCategory('catSalary', { archived: true }), isValidation, 'debe quedar una activa');
});

test('store: deudas con importe inicial, pagos y borrado en cascada', async () => {
  await setup();
  const debt = store.addDebt({ kind: 'owe', name: 'Préstamo coche', dueDate: '2030-01-01' }, { amount: 900000, date: '2026-10-01', accountId: null, note: '' });
  store.addMovement({ type: 'debt', debtId: debt.id, flow: 'pay', amount: 25000, date: '2026-10-05', accountId: 'accountAAA', note: 'Cuota' });
  let state = await reload();
  assert.equal(computeDebtTotals(state).get(debt.id).pending, 875000);
  store.updateDebt(debt.id, { name: 'Coche', kind: 'owed' });
  assert.equal(store.getState().debts.find((d) => d.id === debt.id).kind, 'owe', 'el tipo no se puede cambiar');
  store.deleteDebt(debt.id);
  state = await reload();
  assert.ok(!state.debts.some((d) => d.id === debt.id));
  assert.ok(!state.movements.some((m) => m.debtId === debt.id));
});

test('store: presupuestos (crear, cambiar y quitar)', async () => {
  await setup();
  store.setBudget('catFoodXX', 30000);
  store.setBudget('catFoodXX', 35000);
  assert.equal(store.getState().budgets.filter((b) => b.categoryId === 'catFoodXX').length, 1);
  assert.equal(store.getState().budgets.find((b) => b.categoryId === 'catFoodXX').amount, 35000);
  store.setBudget(null, null);
  assert.ok(!store.getState().budgets.some((b) => b.categoryId === null));
  assert.throws(() => store.setBudget('catSalary', 100), isValidation);
  await reload();
});

test('store: programados (pendientes, sin duplicar, pausa y edición)', async () => {
  await setup();
  const template = { type: 'expense', amount: 1299, accountId: 'accountAAA', categoryId: 'catFunXXX', note: 'Netflix' };
  const { rule, created } = store.addRecurring({ frequency: 'monthly', interval: 1, nextDate: '2026-08-01', endDate: null, template }, '2026-10-05');
  assert.equal(created, 3, 'agosto, septiembre y octubre');
  assert.equal(store.runRecurring('2026-10-05'), 0, 'no se duplican');
  assert.equal(store.runRecurring('2026-11-20'), 1, 'noviembre al llegar su fecha');
  store.setRecurringActive(rule.id, false);
  assert.equal(store.runRecurring('2027-02-20'), 0, 'pausada');
  assert.equal(store.setRecurringActive(rule.id, true, '2027-02-20'), 0, 'al reanudar no recupera dic-feb');
  assert.equal(store.runRecurring('2027-03-15'), 1, 'marzo sí');
  const current = store.getState().recurring.find((r) => r.id === rule.id);
  const indexBefore = current.index;
  store.updateRecurring(rule.id, { frequency: 'monthly', interval: 1, nextDate: '2027-04-01', endDate: null, active: true, template: { ...template, amount: 1499 } }, '2027-03-15');
  const updated = store.getState().recurring.find((r) => r.id === rule.id);
  assert.equal(updated.index, indexBefore, 'cambiar el importe no reancla la regla');
  assert.equal(updated.template.amount, 1499);
  const state = await reload();
  assert.equal(state.movements.filter((m) => m.recurringId === rule.id).length, 5);
  store.deleteRecurring(rule.id);
  const after = await reload();
  assert.equal(after.movements.filter((m) => m.note === 'Netflix').length, 5, 'los movimientos creados se conservan');
  assert.ok(!after.movements.some((m) => m.recurringId === rule.id));
});

test('store: un programado con referencias inválidas se pausa en lugar de fallar', async () => {
  await setup();
  const { rule } = store.addRecurring({ frequency: 'weekly', interval: 1, nextDate: '2026-12-01', endDate: null, template: { type: 'expense', amount: 100, accountId: 'accountAAA', categoryId: 'catFoodXX', note: '' } }, '2026-10-05');
  store.getState().recurring.find((r) => r.id === rule.id).template.categoryId = 'catSalary'; // simula una plantilla rota
  assert.equal(store.runRecurring('2026-12-20'), 0);
  assert.equal(store.getState().recurring.find((r) => r.id === rule.id).active, false);
});

test('store: sustituir todos los datos (restaurar copia)', async () => {
  await setup();
  const other = sampleState();
  other.accounts[0].name = 'Restaurada';
  other.movements = other.movements.filter((m) => m.date.startsWith('2026-10'));
  await store.replaceAll(other);
  const state = await reload();
  assert.equal(state.accounts[0].name, 'Restaurada');
  assert.ok(!state.movements.some((m) => m.id === 'mov00001'));
});
