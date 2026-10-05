import { test, assert } from './runner.js';
import { occurrenceDate, dueOccurrences, firstIndexFrom, countDue, isFinished, nextDate } from '../app/js/core/recurring.js';

const rule = (overrides) => ({
  id: 'ruleTest01', active: true, frequency: 'monthly', interval: 1, startDate: '2026-01-31', index: 0, endDate: null,
  template: { type: 'expense', amount: 100, accountId: 'accountAAA', categoryId: 'catFoodXX', note: '' },
  ...overrides,
});

test('recurring: mensual del día 31 sin deriva', () => {
  const r = rule();
  assert.deepEqual([0, 1, 2, 3].map((i) => occurrenceDate(r, i)), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
});

test('recurring: semanal, cada 2 meses y anual del 29 de febrero', () => {
  assert.equal(occurrenceDate(rule({ frequency: 'weekly', interval: 2, startDate: '2026-10-05' }), 1), '2026-10-19');
  assert.equal(occurrenceDate(rule({ interval: 2, startDate: '2026-11-30' }), 1), '2027-01-30');
  const yearly = rule({ frequency: 'yearly', startDate: '2024-02-29' });
  assert.equal(occurrenceDate(yearly, 1), '2025-02-28');
  assert.equal(occurrenceDate(yearly, 4), '2028-02-29');
});

test('recurring: pendientes hasta hoy, con fin y pausadas', () => {
  const items = dueOccurrences([rule()], '2026-04-15');
  assert.deepEqual(items.map((x) => x.date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(dueOccurrences([rule({ index: 3 })], '2026-04-15').length, 0, 'ya generadas');
  assert.equal(dueOccurrences([rule({ endDate: '2026-03-01' })], '2026-12-31').length, 2, 'respeta la fecha de fin');
  assert.equal(dueOccurrences([rule({ active: false })], '2026-12-31').length, 0, 'pausada');
  assert.equal(dueOccurrences([rule({ frequency: 'weekly', startDate: '2000-01-01' })], '2026-12-31', 50).length, 50, 'tope por ejecución');
});

test('recurring: reanudar sin recuperar las fechas pausadas', () => {
  const r = rule({ index: 1 });
  assert.equal(firstIndexFrom(r, '2026-06-01'), 5, 'primera fecha ≥ 1-jun es 30-jun (índice 5)');
  assert.equal(occurrenceDate(r, 5), '2026-06-30');
  assert.equal(firstIndexFrom(r, '2026-01-01'), 1, 'no retrocede');
});

test('recurring: aviso de cuántos se crearán y fin de la regla', () => {
  assert.equal(countDue(rule({ startDate: '2026-08-01' }), '2026-10-05'), 3);
  assert.equal(countDue(rule({ startDate: '2026-11-01' }), '2026-10-05'), 0);
  const ended = rule({ endDate: '2026-02-01', index: 1 });
  assert.equal(nextDate(ended), '2026-02-28');
  assert.ok(isFinished(ended));
  assert.ok(!isFinished(rule()));
});
