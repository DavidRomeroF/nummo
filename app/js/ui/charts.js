// Gráficas SVG propias (sin librerías), según la guía de visualización:
// marcas finas, extremos redondeados de 4 px, separación de 2 px con el color de la superficie,
// rejilla en línea fina continua, lectura al tocar/enfocar y tabla equivalente para accesibilidad.

import { h, s } from './dom.js';
import { monthLabel, monthShort } from './format.js';
import { formatMoney, formatSigned, formatCompact } from '../core/money.js';

const W = 340; // ancho lógico del viewBox (se escala con max-width en CSS)
const AXIS_W = 40;
const X_LABEL_H = 20;

/** Escala "bonita": límites y marcas redondeadas (0, 500, 1.000…). */
export function niceScale(min, max, count = 4) {
  if (min === max) {
    max = min === 0 ? 100 : min + Math.abs(min) * 0.5;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { lo, hi, ticks };
}

/** Columna con extremo de datos redondeado (4 px) y base recta. */
function columnPath(x, y, w, height, r = 4) {
  if (height <= 0) return '';
  const rr = Math.min(r, w / 2, height);
  return `M${x} ${y + height}V${y + rr}A${rr} ${rr} 0 0 1 ${x + rr} ${y}H${x + w - rr}A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}V${y + height}Z`;
}

function axis(scale, y) {
  return scale.ticks.map((t) => s('g', null,
    s('line', { class: 'grid', x1: AXIS_W, x2: W, y1: y(t), y2: y(t) }),
    s('text', { x: AXIS_W - 6, y: y(t) + 4, 'text-anchor': 'end' }, formatCompact(t))));
}

/** Etiquetas del eje X: cada dos meses, siempre la última. */
function monthLabels(months, xCenter, yPos) {
  return months.map((m, i) => (i % 2 === (months.length - 1) % 2
    ? s('text', { x: xCenter(i), y: yPos, 'text-anchor': 'middle' }, monthShort(m))
    : null));
}

function tableView(caption, headers, rows) {
  return h('details', { class: 'table-view' },
    h('summary', null, 'Ver tabla'),
    h('table', { class: 'table' },
      h('caption', { class: 'sr-only' }, caption),
      h('thead', null, h('tr', null, headers.map((x) => h('th', { scope: 'col' }, x)))),
      h('tbody', null, rows.map((r) => h('tr', null, r.map((cell, i) => (i === 0 ? h('th', { scope: 'row' }, cell) : h('td', null, cell))))))));
}

/** Navegación con flechas entre zonas de una gráfica (accesible con teclado). */
function arrowKeys(targets, select) {
  targets.forEach((target, i) => {
    target.addEventListener('keydown', (event) => {
      const next = event.key === 'ArrowRight' ? i + 1 : event.key === 'ArrowLeft' ? i - 1 : null;
      if (next === null || !targets[next]) return;
      event.preventDefault();
      targets[next].focus();
      select(next);
    });
  });
}

/**
 * Columnas agrupadas de ingresos y gastos por mes.
 * data: [{ month, income, expense }]; la lectura empieza en el último mes.
 */
export function incomeExpenseChart(data) {
  const H = 170;
  const top = 8;
  const bottom = H - X_LABEL_H;
  const max = Math.max(0, ...data.map((d) => Math.max(d.income, d.expense)));
  const scale = niceScale(0, max || 10000);
  const y = (v) => bottom - ((v - scale.lo) / (scale.hi - scale.lo)) * (bottom - top);
  const slot = (W - AXIS_W) / data.length;
  const barW = Math.min(12, (slot - 8) / 2);
  const xCenter = (i) => AXIS_W + slot * i + slot / 2;

  const readout = h('p', { class: 'chart-tip', 'aria-live': 'polite' });
  const band = s('rect', { class: 'sel-band', y: top, width: slot, height: bottom - top, rx: 6 });
  const select = (i) => {
    const d = data[i];
    band.setAttribute('x', String(AXIS_W + slot * i));
    readout.replaceChildren(
      h('span', null, `${monthLabel(d.month)} · `),
      h('span', { class: 'key key-income', 'aria-hidden': 'true' }), 'Ingresos ', h('strong', null, formatMoney(d.income)), ' · ',
      h('span', { class: 'key key-expense', 'aria-hidden': 'true' }), 'Gastos ', h('strong', null, formatMoney(d.expense)));
  };

  const columns = data.map((d, i) => {
    const xc = xCenter(i);
    return s('g', null,
      s('path', { class: 'series-income', d: columnPath(xc - barW - 1, y(d.income), barW, bottom - y(d.income)) }),
      s('path', { class: 'series-expense', d: columnPath(xc + 1, y(d.expense), barW, bottom - y(d.expense)) }));
  });
  const hits = data.map((d, i) => {
    const hit = s('rect', {
      class: 'hit', x: AXIS_W + slot * i, y: 0, width: slot, height: H, tabindex: '0', role: 'img',
      'aria-label': `${monthLabel(d.month)}: ingresos ${formatMoney(d.income)}, gastos ${formatMoney(d.expense)}`,
    });
    for (const type of ['pointerenter', 'pointerdown', 'focus']) hit.addEventListener(type, () => select(i));
    return hit;
  });
  arrowKeys(hits, select);

  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Ingresos y gastos por mes' },
    axis(scale, y),
    band,
    columns,
    s('line', { class: 'axis', x1: AXIS_W, x2: W, y1: bottom, y2: bottom }),
    monthLabels(data.map((d) => d.month), xCenter, H - 4),
    hits);
  select(data.length - 1);

  return h('div', { class: 'chart-box' },
    h('ul', { class: 'chart-legend' },
      h('li', null, h('i', { class: 'swatch-income' }), 'Ingresos'),
      h('li', null, h('i', { class: 'swatch-expense' }), 'Gastos')),
    readout,
    svg,
    tableView('Ingresos y gastos por mes', ['Mes', 'Ingresos', 'Gastos', 'Resultado'],
      data.map((d) => [monthLabel(d.month), formatMoney(d.income), formatMoney(d.expense), formatSigned(d.income - d.expense)])));
}

/** Línea de patrimonio neto al final de cada mes (una sola serie: sin leyenda). */
export function netWorthChart(data) {
  const H = 160;
  const top = 12;
  const bottom = H - X_LABEL_H;
  const values = data.map((d) => d.value);
  const scale = niceScale(Math.min(0, ...values), Math.max(...values, 0));
  const y = (v) => bottom - ((v - scale.lo) / (scale.hi - scale.lo)) * (bottom - top);
  const step = (W - AXIS_W - 16) / Math.max(1, data.length - 1);
  const x = (i) => AXIS_W + 8 + step * i;
  const points = data.map((d, i) => `${x(i).toFixed(1)} ${y(d.value).toFixed(1)}`);
  const zeroY = y(Math.max(scale.lo, Math.min(0, scale.hi)));

  const readout = h('p', { class: 'chart-tip', 'aria-live': 'polite' });
  const crosshair = s('line', { class: 'crosshair', y1: top, y2: bottom });
  const dot = s('circle', { class: 'dot', r: 4 });
  const select = (i) => {
    crosshair.setAttribute('x1', String(x(i)));
    crosshair.setAttribute('x2', String(x(i)));
    dot.setAttribute('cx', String(x(i)));
    dot.setAttribute('cy', String(y(data[i].value)));
    readout.replaceChildren(h('span', null, `${monthLabel(data[i].month)} · `), h('strong', null, formatMoney(data[i].value)));
  };
  const hits = data.map((d, i) => {
    const hit = s('rect', {
      class: 'hit', x: x(i) - step / 2, y: 0, width: step, height: H, tabindex: '0', role: 'img',
      'aria-label': `${monthLabel(d.month)}: ${formatMoney(d.value)}`,
    });
    for (const type of ['pointerenter', 'pointerdown', 'focus']) hit.addEventListener(type, () => select(i));
    return hit;
  });
  arrowKeys(hits, select);

  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'group', 'aria-label': 'Patrimonio neto por mes' },
    axis(scale, y),
    s('path', { class: 'area', d: `M${x(0)} ${zeroY}L${points.join('L')}L${x(data.length - 1)} ${zeroY}Z` }),
    s('line', { class: 'axis', x1: AXIS_W, x2: W, y1: zeroY, y2: zeroY }),
    s('path', { class: 'line', d: `M${points.join('L')}` }),
    crosshair,
    dot,
    monthLabels(data.map((d) => d.month), x, H - 4),
    hits);
  select(data.length - 1);

  return h('div', { class: 'chart-box' },
    readout,
    svg,
    tableView('Patrimonio neto por mes', ['Mes', 'Patrimonio'], data.map((d) => [monthLabel(d.month), formatMoney(d.value)])));
}

function arc(cx, cy, outer, inner, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const point = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
  return `M${point(outer, a0)}A${outer} ${outer} 0 ${large} 1 ${point(outer, a1)}L${point(inner, a1)}A${inner} ${inner} 0 ${large} 0 ${point(inner, a0)}Z`;
}

/**
 * Anillo de reparto (como mucho 6 porciones: las 5 mayores + «Otras»).
 * segments: [{ label, value, tone }]. La leyenda con importes la pinta quien llama.
 */
export function donutChart(segments, { total, centerLabel }) {
  const size = 148;
  const c = size / 2;
  const outer = c - 2;
  const inner = outer - 22;
  let angle = -Math.PI / 2;
  const paths = [];
  for (const segment of segments) {
    if (segment.value <= 0) continue;
    const sweep = (segment.value / total) * Math.PI * 2;
    if (sweep >= Math.PI * 2 - 1e-6) {
      // Una sola porción: dos medias vueltas (un arco de 360° no se puede dibujar).
      paths.push(s('path', { class: ['segment', `tone-${segment.tone}`], d: arc(c, c, outer, inner, angle, angle + Math.PI) }));
      paths.push(s('path', { class: ['segment', `tone-${segment.tone}`], d: arc(c, c, outer, inner, angle + Math.PI, angle + Math.PI * 2) }));
    } else {
      paths.push(s('path', { class: ['segment', `tone-${segment.tone}`], d: arc(c, c, outer, inner, angle, angle + sweep) }));
    }
    angle += sweep;
  }
  const label = segments.map((x) => `${x.label} ${Math.round((x.value / total) * 100)} %`).join(', ');
  return s('svg', { class: 'chart donut', viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `Reparto: ${label}` },
    paths,
    s('text', { class: 'donut-value', x: c, y: c + 2, 'text-anchor': 'middle' }, formatMoney(total)),
    s('text', { class: 'donut-caption', x: c, y: c + 18, 'text-anchor': 'middle' }, centerLabel));
}
