import { test, assert } from './runner.js';
import {
  daysInMonth, parseISO, isISODate, isMonthKey, addDays, addMonths, addYears, addMonthKey,
  monthBounds, diffDays, todayISO, monthKey,
} from '../app/js/core/dates.js';

test('dates: días por mes y años bisiestos', () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 12), 31);
});

test('dates: validación de fechas y meses', () => {
  assert.ok(isISODate('2024-02-29'));
  for (const bad of ['2026-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-01', '', null, '1969-12-31', '2201-01-01']) {
    assert.ok(!isISODate(bad), `«${bad}»`);
  }
  assert.deepEqual(parseISO('2026-10-05'), { y: 2026, m: 10, d: 5 });
  assert.ok(isMonthKey('2026-10') && !isMonthKey('2026-13') && !isMonthKey('2026-1'));
});

test('dates: sumar días cruzando meses y años', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-03-28', 7), '2026-04-04'); // cambio de hora en marzo: sin efecto
});

test('dates: sumar meses con día de anclaje', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
  assert.equal(addYears('2024-02-29', 1), '2025-02-28');
  assert.equal(addYears('2024-02-29', 4), '2028-02-29');
});

test('dates: claves de mes, límites y diferencias', () => {
  assert.equal(addMonthKey('2026-01', -1), '2025-12');
  assert.equal(addMonthKey('2026-12', 1), '2027-01');
  assert.equal(addMonthKey('2026-10', -12), '2025-10');
  assert.deepEqual(monthBounds('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.equal(diffDays('2026-01-01', '2026-03-01'), 59);
  assert.equal(diffDays('2026-03-01', '2026-01-01'), -59);
  assert.equal(todayISO(new Date(2026, 9, 5, 23, 59)), '2026-10-05');
  assert.equal(monthKey('2026-10-05'), '2026-10');
});
