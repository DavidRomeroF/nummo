// Análisis: resumen del mes, reparto por categoría, presupuestos y evolución de 12 meses.

import { h } from '../ui/dom.js';
import { section, monthNav, segmented, tile, emptyState, progress } from '../ui/components.js';
import { lookups } from '../ui/format.js';
import { incomeExpenseChart, netWorthChart, donutChart } from '../ui/charts.js';
import { rerender } from '../ui/shell.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import { formatMoney, formatSigned } from '../core/money.js';
import { currentMonthKey } from '../core/dates.js';
import { showMovementsFor } from './movements.js';

const MAX_SEGMENTS = 6; // 5 categorías + «Otras»
let monthKey = currentMonthKey();
let breakdown = 'expense';

const stat = (label, value, className = '') => h('div', { class: 'stat' },
  h('span', { class: 'stat-label' }, label),
  h('span', { class: ['stat-value', className] }, value));

function categoryCard(state, look, derived) {
  const totals = derived.byCategory(monthKey, breakdown);
  const total = totals.reduce((sum, x) => sum + x.amount, 0);
  const switcher = segmented([{ value: 'expense', label: 'Gastos' }, { value: 'income', label: 'Ingresos' }], breakdown, (value) => {
    breakdown = value;
    rerender();
  }, { label: 'Reparto de' });
  if (!total) {
    return h('section', { class: 'card' }, switcher,
      emptyState('chart-pie', breakdown === 'expense' ? 'Sin gastos este mes' : 'Sin ingresos este mes'));
  }
  const top = totals.slice(0, MAX_SEGMENTS - 1);
  const rest = totals.slice(MAX_SEGMENTS - 1);
  const segments = top.map((x) => {
    const category = look.categories.get(x.categoryId);
    return { label: category?.name ?? 'Sin categoría', value: x.amount, tone: category?.color ?? 'gray' };
  });
  if (rest.length) segments.push({ label: 'Otras', value: rest.reduce((sum, x) => sum + x.amount, 0), tone: 'gray' });

  const pct = (value) => `${Math.round((value / total) * 100)} %`;
  const legend = h('ul', { class: 'share-list' }, totals.map((x) => {
    const category = look.categories.get(x.categoryId);
    return h('li', null, h('button', {
      type: 'button',
      onClick: () => showMovementsFor({ categoryId: x.categoryId }, monthKey),
      'aria-label': `${category?.name}: ${formatMoney(x.amount)}, ${pct(x.amount)}. Ver movimientos`,
    },
    tile(category ?? { icon: 'tag', color: 'gray' }, 'sm'),
    h('span', { class: 'name' }, category?.name ?? 'Sin categoría'),
    h('span', { class: 'val' }, `${formatMoney(x.amount)} · ${pct(x.amount)}`)));
  }));
  return h('section', { class: 'card' },
    switcher,
    h('div', { class: 'donut-wrap' },
      donutChart(segments, { total, centerLabel: breakdown === 'expense' ? 'gastado' : 'ingresado' }),
      h('p', { class: 'help' }, rest.length ? `Las ${rest.length} categorías más pequeñas se agrupan en «Otras» (gris).` : 'Toca una categoría para ver sus movimientos.')),
    legend);
}

function budgetsCard(look, derived) {
  const budgets = derived.budgets(monthKey);
  if (!budgets.length) {
    return h('section', { class: 'card' },
      emptyState('target', 'Sin presupuestos', 'Pon un límite mensual a tus categorías y te avisaré al acercarte.', {
        label: 'Crear presupuesto', onClick: () => router.navigate('/mas/presupuestos'),
      }));
  }
  return h('ul', { class: 'list' }, budgets.map((b) => {
    const category = look.categories.get(b.categoryId);
    const badge = b.level === 'over' ? ['danger', 'Superado'] : b.level === 'warn' ? ['warn', 'Cerca del límite'] : ['ok', 'Bien'];
    return h('li', null, h('div', { class: 'budget' },
      h('div', { class: 'budget-top' },
        category ? tile(category, 'sm') : tile({ icon: 'target', color: 'graphite' }, 'sm'),
        h('span', { class: 'row-main row-title' }, category?.name ?? 'Total del mes'),
        h('span', { class: ['badge', badge[0]] }, badge[1])),
      progress(b.ratio, b.level, `Gastado del presupuesto de ${category?.name ?? 'total'}`),
      h('div', { class: 'budget-meta' },
        h('span', null, `${formatMoney(b.spent)} de ${formatMoney(b.amount)} (${Math.round(b.ratio * 100)} %)`),
        h('span', { class: b.remaining < 0 ? 'neg' : '' }, b.remaining < 0 ? `${formatMoney(-b.remaining)} de más` : `Quedan ${formatMoney(b.remaining)}`))));
  }));
}

export function statsView() {
  const state = store.getState();
  const derived = store.derived();
  const look = lookups(state);
  const month = derived.month(monthKey);
  const savingsRate = month.income > 0 ? Math.round(((month.income - month.expense) / month.income) * 100) : null;

  return {
    title: 'Análisis',
    body: [
      monthNav(monthKey, (key) => { monthKey = key; rerender(); }),
      h('section', { class: 'card' },
        h('div', { class: 'stats two' },
          stat('Ingresos', formatMoney(month.income)),
          stat('Gastos', formatMoney(month.expense)),
          stat('Ahorro', formatSigned(month.income - month.expense), month.income - month.expense < 0 ? 'neg' : ''),
          savingsRate !== null ? stat('Tasa de ahorro', `${savingsRate} %`) : null),
        month.debtNet ? h('p', { class: 'help' }, `Además, pagos y cobros de deudas: ${formatSigned(month.debtNet)} (no cuentan como gasto ni ingreso).`) : null),
      section({ title: 'Por categoría' }, categoryCard(state, look, derived)),
      section({ title: 'Presupuestos', action: { label: 'Gestionar', onClick: () => router.navigate('/mas/presupuestos') } }, budgetsCard(look, derived)),
      section({ title: 'Ingresos y gastos', caption: 'Últimos 12 meses hasta el mes elegido. Toca una columna para ver sus cifras.' },
        h('div', { class: 'card' }, incomeExpenseChart(derived.monthly(monthKey, 12)))),
      section({ title: 'Patrimonio neto', caption: 'Cuentas incluidas en el total − lo que debes + lo que te deben, a final de cada mes.' },
        h('div', { class: 'card' }, netWorthChart(derived.netWorth(monthKey, 12)))),
    ],
  };
}
