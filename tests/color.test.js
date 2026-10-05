import { test, assert } from './runner.js';
import {
  isHexColor, contrast, luminance, toOklch, fromOklch, shiftUntil, accentTokens, SURFACES, TEXT_ON_LIGHT,
} from '../app/js/core/color.js';

test('color: contraste WCAG de referencia', () => {
  assert.equal(Math.round(contrast('#FFFFFF', '#000000') * 10) / 10, 21);
  assert.equal(contrast('#777777', '#777777'), 1);
  assert.equal(Math.round(luminance('#FFFFFF') * 1000) / 1000, 1);
  assert.ok(isHexColor('#0a64d8') && !isHexColor('0A64D8') && !isHexColor('#fff') && !isHexColor('red') && !isHexColor(null));
});

test('color: ida y vuelta por OKLCH sin cambiar el color', () => {
  for (const hex of ['#0A64D8', '#FF3B30', '#34C759', '#FFCC00', '#5E5CE6', '#808080', '#000000', '#FFFFFF']) {
    assert.equal(fromOklch(toOklch(hex)), hex, hex);
  }
});

test('color: aclarar u oscurecer hasta cumplir una condición', () => {
  const dark = shiftUntil('#FFF3B0', -1, (c) => contrast(c, '#FFFFFF') >= 4.5);
  assert.ok(contrast(dark, '#FFFFFF') >= 4.5);
  const light = shiftUntil('#001F5C', 1, (c) => contrast(c, '#1C1C1E') >= 4.5);
  assert.ok(contrast(light, '#1C1C1E') >= 4.5);
  assert.equal(shiftUntil('#123456', 1, () => true), '#123456', 'si ya cumple, no cambia');
});

test('color: cualquier color elegido produce tonos legibles en claro y oscuro', () => {
  const extremes = ['#0A64D8', '#FFF3B0', '#FFFF00', '#001F5C', '#000000', '#FFFFFF', '#FF2D55', '#34C759', '#8E8E93', '#7FFFD4', '#5E5CE6', '#AF52DE'];
  for (const base of extremes) {
    const tokens = accentTokens(base);
    for (const mode of ['light', 'dark']) {
      const t = tokens[mode];
      const { page, card } = SURFACES[mode];
      assert.ok(contrast(t['--accent'], page) >= 4.5 && contrast(t['--accent'], card) >= 4.5, `${base} ${mode}: texto de color legible`);
      assert.ok(contrast(t['--on-accent'], t['--accent-fill']) >= 4.5, `${base} ${mode}: texto sobre botón legible`);
      assert.ok(contrast(t['--accent-fill'], card) >= (mode === 'light' ? 1.6 : 2) - 0.01, `${base} ${mode}: botón visible sobre la tarjeta`);
      assert.ok(/^#[0-9A-F]{8}$/.test(t['--accent-bg']), `${base} ${mode}: tinte con transparencia`);
    }
  }
});

test('color: los colores medios llevan texto blanco y los claros texto oscuro', () => {
  assert.equal(accentTokens('#0A64D8').light['--on-accent'], '#FFFFFF');
  assert.equal(accentTokens('#FFF3B0').light['--on-accent'], TEXT_ON_LIGHT);
  assert.throws(() => accentTokens('azul'), (e) => e instanceof TypeError);
});
