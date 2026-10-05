import { test, assert } from './runner.js';
import { parseAmount, formatMoney, formatSigned, centsToInput, isCents, MAX_CENTS } from '../app/js/core/money.js';

const plain = (s) => s.replace(/[  ]/g, ' ');

test('money: importes válidos en formato español e inglés', () => {
  const cases = {
    '12': 1200, '12,5': 1250, '12,50': 1250, '12.5': 1250, '0,99': 99, ',5': 50, '0012,5': 1250,
    '1.234': 123400, '1.234,56': 123456, '1,234.56': 123456, '1 234,56 €': 123456, '1.234.567': 123456700,
    '12,345': 1234500, '999999999,99': MAX_CENTS, '0': 0, '0,00': 0, '  7  ': 700,
  };
  for (const [input, cents] of Object.entries(cases)) assert.equal(parseAmount(input), cents, `«${input}»`);
});

test('money: importes no válidos devuelven null', () => {
  for (const input of ['', 'abc', '12,', '1,2,3', '12,345,67', '12.34.56', '1.23,45', '0.125', '1234567890', '12,555,0', '1e3', '--5', null, undefined, {}]) {
    assert.equal(parseAmount(input), null, `«${input}»`);
  }
  assert.equal(parseAmount('1,234'), 123400, '«1,234» se interpreta como separador de miles');
});

test('money: negativos solo si se permiten', () => {
  assert.equal(parseAmount('-5'), null);
  assert.equal(parseAmount('-5', { allowNegative: true }), -500);
  assert.equal(parseAmount('−12,30', { allowNegative: true }), -1230);
  assert.equal(parseAmount('-0', { allowNegative: true }), 0);
});

test('money: formato en euros (es-ES)', () => {
  assert.equal(plain(formatMoney(123456)), '1.234,56 €', 'agrupa también las cifras de 4 dígitos');
  assert.equal(plain(formatMoney(1234567)), '12.345,67 €');
  assert.equal(plain(formatMoney(-50)), '-0,50 €');
  assert.equal(plain(formatSigned(1250)), '+12,50 €');
  assert.equal(plain(formatSigned(-1250)), '-12,50 €');
  assert.equal(plain(formatSigned(0)), '0,00 €');
});

test('money: texto editable y comprobación de céntimos', () => {
  assert.equal(centsToInput(123456), '1234,56');
  assert.equal(centsToInput(-5), '-0,05');
  assert.equal(centsToInput(0), '0,00');
  assert.equal(parseAmount(centsToInput(98765)), 98765, 'ida y vuelta');
  assert.ok(isCents(10) && !isCents(1.5) && !isCents(MAX_CENTS + 1) && !isCents('10'));
  assert.ok(!isCents(0, { min: 1 }));
});
