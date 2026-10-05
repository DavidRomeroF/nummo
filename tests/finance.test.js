import { test, assert } from './runner.js';
import { sampleState } from './fixtures.js';
import {
  computeBalances, computeDebtTotals, summarize, monthSummary, totalsByCategory, budgetStatus,
  monthlySeries, netWorthSeries, debtAccountSign, createDerived,
} from '../app/js/core/finance.js';

test('finance: signo de los movimientos de deuda sobre la cuenta', () => {
  assert.equal(debtAccountSign('owe', 'add'), 1, 'me prestan: entra dinero');
  assert.equal(debtAccountSign('owe', 'pay'), -1, 'pago: sale dinero');
  assert.equal(debtAccountSign('owed', 'add'), -1, 'presto: sale dinero');
  assert.equal(debtAccountSign('owed', 'pay'), 1, 'me pagan: entra dinero');
});

test('finance: saldos de cuentas con todos los tipos de movimiento', () => {
  const balances = computeBalances(sampleState());
  assert.equal(balances.get('accountAAA'), 100000 - 5000 + 200000 - 10000 + 30000 - 10000);
  assert.equal(balances.get('accountBBB'), 10000 - 4000);
  assert.equal(balances.get('accountCCC'), 50000 - 2000);
  const september = computeBalances(sampleState(), '2026-09-30');
  assert.equal(september.get('accountAAA'), 95000, 'saldo hasta una fecha');
});

test('finance: pendiente de cada deuda', () => {
  const totals = computeDebtTotals(sampleState());
  assert.deepEqual(totals.get('debtOweXX'), { added: 30000, paid: 10000, pending: 20000, lastDate: '2026-10-04' });
  assert.equal(totals.get('debtOwedX').pending, 2500);
});

test('finance: totales y patrimonio neto (cuentas excluidas no cuentan)', () => {
  const s = summarize(sampleState());
  assert.equal(s.totalBalance, 305000 + 6000);
  assert.equal(s.totalOwe, 20000);
  assert.equal(s.totalOwed, 2500);
  assert.equal(s.netWorth, 311000 - 20000 + 2500);
});

test('finance: resumen mensual (las deudas van aparte y las transferencias no cuentan)', () => {
  assert.deepEqual(monthSummary(sampleState(), '2026-10'), {
    income: 200000, expense: 2000, debtIn: 30000, debtOut: 14000, debtNet: 16000, result: 214000,
  });
  assert.equal(monthSummary(sampleState(), '2026-09').result, -5000);
  assert.equal(monthSummary(sampleState(), '2026-08').result, 0);
});

test('finance: gastos por categoría y presupuestos', () => {
  assert.deepEqual(totalsByCategory(sampleState(), '2026-10'), [{ categoryId: 'catFunXXX', amount: 2000 }]);
  assert.deepEqual(totalsByCategory(sampleState(), '2026-10', 'income'), [{ categoryId: 'catSalary', amount: 200000 }]);
  const [total, fun] = budgetStatus(sampleState(), '2026-10');
  assert.equal(total.categoryId, null, 'el presupuesto total va primero');
  assert.equal(total.spent, 2000);
  assert.equal(total.level, 'ok');
  assert.equal(fun.spent, 2000);
  assert.equal(fun.remaining, -500);
  assert.equal(fun.level, 'over');
  const state = sampleState();
  state.budgets[1].amount = 2000;
  assert.equal(budgetStatus(state, '2026-10')[1].level, 'warn', 'justo en el límite = aviso');
  state.budgets[1].amount = 2500;
  assert.equal(budgetStatus(state, '2026-10')[1].level, 'warn', 'al 80 % avisa');
  state.budgets[1].amount = 2600;
  assert.equal(budgetStatus(state, '2026-10')[1].level, 'ok', 'al 77 % todavía no avisa');
});

test('finance: series mensuales y de patrimonio', () => {
  assert.deepEqual(monthlySeries(sampleState(), '2026-10', 3), [
    { month: '2026-08', income: 0, expense: 0 },
    { month: '2026-09', income: 0, expense: 5000 },
    { month: '2026-10', income: 200000, expense: 2000 },
  ]);
  const series = netWorthSeries(sampleState(), '2026-10', 3);
  assert.deepEqual(series.map((p) => p.value), [100000, 95000, 293500]);
  assert.equal(series.at(-1).value, summarize(sampleState()).netWorth, 'el último punto coincide con el patrimonio actual');
});

test('finance: los cálculos derivados se cachean por versión', () => {
  const d = createDerived(sampleState());
  assert.ok(d.summary === d.summary);
  assert.ok(d.month('2026-10') === d.month('2026-10'));
  assert.equal(d.budgets('2026-10').length, 2);
});

test('finance: una deuda pagada de más no reduce el total que debes de las demás', () => {
  const state = sampleState();
  state.movements.push({ id: 'movOver01', date: '2026-10-08', type: 'debt', amount: 50000, debtId: 'debtOwedX', flow: 'pay', accountId: null, note: '', ts: 9 });
  const s = summarize(state); // Laura pagó 500 € de más
  assert.equal(s.totalOwed, 0, 'te deben 0, no un número negativo');
  assert.equal(s.totalOwe, 20000);
  assert.equal(s.netWorth, 311000 - 20000 + (2500 - 50000), 'el patrimonio sí refleja el pago de más');
});
