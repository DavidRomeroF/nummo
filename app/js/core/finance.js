// Cálculos derivados: saldos, deudas, resúmenes mensuales, presupuestos y series para gráficas.
// Funciones puras: leen el estado y nunca lo modifican. Todas son de una sola pasada, O(n).

import { addMonthKey, monthBounds, monthKey } from './dates.js';

/**
 * Signo del efecto de un movimiento de deuda sobre la cuenta vinculada:
 * Debo + me prestan → entra (+) · Debo + pago → sale (−)
 * Me deben + presto → sale (−) · Me deben + me pagan → entra (+)
 */
export function debtAccountSign(debtKind, flow) {
  return (debtKind === 'owe') === (flow === 'add') ? 1 : -1;
}

const debtKinds = (state) => new Map(state.debts.map((d) => [d.id, d.kind]));

/** Cambios de saldo que produce un movimiento: lista de [cuentaId, céntimos]. */
export function accountEffects(m, debtKindById) {
  switch (m.type) {
    case 'expense': return [[m.accountId, -m.amount]];
    case 'income': return [[m.accountId, m.amount]];
    case 'transfer': return [[m.accountId, -m.amount], [m.toAccountId, m.amount]];
    case 'debt':
      return m.accountId ? [[m.accountId, debtAccountSign(debtKindById.get(m.debtId), m.flow) * m.amount]] : [];
    default: return [];
  }
}

/** Saldo de cada cuenta (opcionalmente hasta una fecha incluida). */
export function computeBalances(state, untilDate = null) {
  const kinds = debtKinds(state);
  const balances = new Map(state.accounts.map((a) => [a.id, a.initial]));
  for (const m of state.movements) {
    if (untilDate && m.date > untilDate) continue;
    for (const [id, delta] of accountEffects(m, kinds)) balances.set(id, (balances.get(id) ?? 0) + delta);
  }
  return balances;
}

/** Por deuda: total añadido, total pagado, pendiente y fechas del primer/último movimiento. */
export function computeDebtTotals(state) {
  const totals = new Map(state.debts.map((d) => [d.id, { added: 0, paid: 0, pending: 0, firstDate: null, lastDate: null, count: 0 }]));
  for (const m of state.movements) {
    if (m.type !== 'debt') continue;
    const t = totals.get(m.debtId);
    if (!t) continue;
    if (m.flow === 'add') t.added += m.amount;
    else t.paid += m.amount;
    t.count += 1;
    if (!t.firstDate || m.date < t.firstDate) t.firstDate = m.date;
    if (!t.lastDate || m.date > t.lastDate) t.lastDate = m.date;
  }
  for (const t of totals.values()) t.pending = t.added - t.paid;
  return totals;
}

/** Totales generales. Patrimonio neto = cuentas incluidas en el total − lo que debo + lo que me deben. */
export function summarize(state) {
  const balances = computeBalances(state);
  const debtTotals = computeDebtTotals(state);
  let totalBalance = 0;
  for (const a of state.accounts) if (a.includeInTotal) totalBalance += balances.get(a.id) ?? 0;
  let owe = 0;
  let owed = 0;
  for (const d of state.debts) {
    const pending = debtTotals.get(d.id).pending;
    if (d.kind === 'owe') owe += pending;
    else owed += pending;
  }
  return {
    balances,
    debtTotals,
    totalBalance,
    totalOwe: Math.max(owe, 0),
    totalOwed: Math.max(owed, 0),
    netWorth: totalBalance - owe + owed,
  };
}

/**
 * Resumen de un mes 'AAAA-MM'. Los movimientos de deuda no son gasto ni ingreso: se muestran
 * aparte (debtIn/debtOut) y solo cuentan si pasaron por una cuenta. Las transferencias no cuentan.
 */
export function monthSummary(state, key) {
  const { start, end } = monthBounds(key);
  const kinds = debtKinds(state);
  let income = 0;
  let expense = 0;
  let debtIn = 0;
  let debtOut = 0;
  for (const m of state.movements) {
    if (m.date < start || m.date > end) continue;
    if (m.type === 'income') income += m.amount;
    else if (m.type === 'expense') expense += m.amount;
    else if (m.type === 'debt' && m.accountId) {
      if (debtAccountSign(kinds.get(m.debtId), m.flow) > 0) debtIn += m.amount;
      else debtOut += m.amount;
    }
  }
  return { income, expense, debtIn, debtOut, debtNet: debtIn - debtOut, result: income - expense + debtIn - debtOut };
}

/** Total por categoría en un mes, de mayor a menor. type: 'expense' | 'income'. */
export function totalsByCategory(state, key, type = 'expense') {
  const { start, end } = monthBounds(key);
  const totals = new Map();
  for (const m of state.movements) {
    if (m.type !== type || m.date < start || m.date > end) continue;
    totals.set(m.categoryId, (totals.get(m.categoryId) ?? 0) + m.amount);
  }
  return [...totals].map(([categoryId, amount]) => ({ categoryId, amount })).sort((a, b) => b.amount - a.amount);
}

export const BUDGET_WARN_RATIO = 0.8;

/** Estado de cada presupuesto en un mes: gastado, restante y nivel ('ok' | 'warn' | 'over'). */
export function budgetStatus(state, key) {
  const byCategory = totalsByCategory(state, key, 'expense');
  const spentBy = new Map(byCategory.map((x) => [x.categoryId, x.amount]));
  const totalSpent = byCategory.reduce((sum, x) => sum + x.amount, 0);
  return state.budgets
    .map((b) => {
      const spent = b.categoryId === null ? totalSpent : spentBy.get(b.categoryId) ?? 0;
      const ratio = spent / b.amount;
      const level = spent > b.amount ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok';
      return { ...b, spent, remaining: b.amount - spent, ratio, level };
    })
    .sort((a, b) => (a.categoryId === null ? -1 : b.categoryId === null ? 1 : b.ratio - a.ratio));
}

const monthRange = (endKey, count) => Array.from({ length: count }, (_, i) => addMonthKey(endKey, i - count + 1));

/** Ingresos y gastos de los últimos `count` meses hasta `endKey` (incluido). */
export function monthlySeries(state, endKey, count) {
  const months = monthRange(endKey, count);
  const index = new Map(months.map((k, i) => [k, i]));
  const series = months.map((month) => ({ month, income: 0, expense: 0 }));
  for (const m of state.movements) {
    if (m.type !== 'income' && m.type !== 'expense') continue;
    const i = index.get(monthKey(m.date));
    if (i !== undefined) series[i][m.type] += m.amount;
  }
  return series;
}

/** Patrimonio neto al final de cada uno de los últimos `count` meses hasta `endKey`. */
export function netWorthSeries(state, endKey, count) {
  const months = monthRange(endKey, count);
  const kinds = debtKinds(state);
  const included = new Set(state.accounts.filter((a) => a.includeInTotal).map((a) => a.id));
  let value = state.accounts.reduce((sum, a) => sum + (a.includeInTotal ? a.initial : 0), 0);
  const deltas = [];
  for (const m of state.movements) {
    let delta = 0;
    for (const [id, d] of accountEffects(m, kinds)) if (included.has(id)) delta += d;
    if (m.type === 'debt') {
      const pendingDelta = m.flow === 'add' ? m.amount : -m.amount;
      delta += kinds.get(m.debtId) === 'owe' ? -pendingDelta : pendingDelta;
    }
    if (delta !== 0) deltas.push([m.date, delta]);
  }
  deltas.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const series = [];
  let j = 0;
  for (const month of months) {
    const { end } = monthBounds(month);
    while (j < deltas.length && deltas[j][0] <= end) value += deltas[j++][1];
    series.push({ month, value });
  }
  return series;
}

/** Cálculos perezosos y cacheados para una versión concreta del estado. */
export function createDerived(state) {
  let summary = null;
  const months = new Map();
  const cached = (key, fn) => {
    if (!months.has(key)) months.set(key, fn());
    return months.get(key);
  };
  return {
    get summary() {
      summary ??= summarize(state);
      return summary;
    },
    month: (key) => cached(`m:${key}`, () => monthSummary(state, key)),
    byCategory: (key, type = 'expense') => cached(`c:${type}:${key}`, () => totalsByCategory(state, key, type)),
    budgets: (key) => cached(`b:${key}`, () => budgetStatus(state, key)),
    monthly: (endKey, count) => cached(`s:${endKey}:${count}`, () => monthlySeries(state, endKey, count)),
    netWorth: (endKey, count) => cached(`n:${endKey}:${count}`, () => netWorthSeries(state, endKey, count)),
  };
}
