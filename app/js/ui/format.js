// Textos para la interfaz: fechas en español, periodicidades y descripción de movimientos.

import { toLocalDate, addDays, todayISO, diffDays } from '../core/dates.js';
import { formatMoney, formatSigned } from '../core/money.js';
import { debtAccountSign } from '../core/finance.js';

const fmtWeekday = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtWeekdayYear = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const fmtShortYear = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonthName = new Intl.DateTimeFormat('es-ES', { month: 'long' });
const fmtMonthShort = new Intl.DateTimeFormat('es-ES', { month: 'short' });

export const capitalize = (text) => (text ? text[0].toLocaleUpperCase('es-ES') + text.slice(1) : text);

/** "Hoy", "Ayer", "Lunes, 5 de octubre" (con año si no es el actual). */
export function dayLabel(iso, today = todayISO()) {
  if (iso === today) return 'Hoy';
  if (iso === addDays(today, -1)) return 'Ayer';
  if (iso === addDays(today, 1)) return 'Mañana';
  const fmt = iso.slice(0, 4) === today.slice(0, 4) ? fmtWeekday : fmtWeekdayYear;
  return capitalize(fmt.format(toLocalDate(iso)));
}

/** "5 oct" o "5 oct 2025". */
export function shortDate(iso, today = todayISO()) {
  const fmt = iso.slice(0, 4) === today.slice(0, 4) ? fmtShort : fmtShortYear;
  return fmt.format(toLocalDate(iso)).replace('.', '');
}

/** "Octubre 2026" */
export function monthLabel(key) {
  return `${capitalize(fmtMonthName.format(toLocalDate(`${key}-01`)))} ${key.slice(0, 4)}`;
}

/** "oct" (ejes de gráficas) */
export function monthShort(key) {
  return fmtMonthShort.format(toLocalDate(`${key}-01`)).replace('.', '');
}

/** "hoy", "hace 3 días", "hace 2 meses" */
export function ago(timestampMs, now = Date.now()) {
  const days = Math.floor((now - timestampMs) / 86_400_000);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 45) return `hace ${days} días`;
  const months = Math.round(days / 30);
  return months < 18 ? `hace ${months} meses` : `hace ${Math.round(days / 365)} años`;
}

/** Texto de vencimiento de una deuda: { text, level } */
export function dueText(dueDate, today = todayISO()) {
  if (!dueDate) return null;
  const days = diffDays(today, dueDate);
  if (days < 0) return { text: `Venció el ${shortDate(dueDate, today)}`, level: 'danger' };
  if (days === 0) return { text: 'Vence hoy', level: 'warn' };
  if (days <= 7) return { text: `Vence en ${days} ${days === 1 ? 'día' : 'días'}`, level: 'warn' };
  return { text: `Vence el ${shortDate(dueDate, today)}`, level: null };
}

const UNIT = { weekly: ['semana', 'semanas'], monthly: ['mes', 'meses'], yearly: ['año', 'años'] };

/** "Cada mes", "Cada 2 semanas" */
export function frequencyLabel(frequency, interval) {
  const [one, many] = UNIT[frequency];
  return interval === 1 ? `Cada ${one}` : `Cada ${interval} ${many}`;
}

const DEBT_TITLES = {
  'owe:add': (name) => `Préstamo de ${name}`,
  'owe:pay': (name) => `Pago a ${name}`,
  'owed:add': (name) => `Préstamo a ${name}`,
  'owed:pay': (name) => `Cobro de ${name}`,
};
export const DEBT_FLOW_LABELS = {
  'owe:add': 'Me han prestado más',
  'owe:pay': 'Pago',
  'owed:add': 'He prestado más',
  'owed:pay': 'Cobro',
};

/**
 * Cómo se muestra un movimiento: título, subtítulo, icono, color e importe con signo.
 * lookups: { accounts: Map, categories: Map, debts: Map }
 */
export function describeMovement(m, { accounts, categories, debts }) {
  const account = accounts.get(m.accountId);
  const note = m.note;
  if (m.type === 'transfer') {
    const to = accounts.get(m.toAccountId);
    return {
      title: note || 'Transferencia',
      subtitle: `${account?.name ?? '—'} → ${to?.name ?? '—'}`,
      icon: 'arrows-exchange',
      tone: 'graphite',
      amount: formatMoney(m.amount),
      amountClass: 'neutral',
    };
  }
  if (m.type === 'debt') {
    const debt = debts.get(m.debtId);
    const key = `${debt?.kind}:${m.flow}`;
    const sign = debt ? debtAccountSign(debt.kind, m.flow) : 0;
    return {
      title: debt ? DEBT_TITLES[key](debt.name) : 'Deuda',
      subtitle: [note, account?.name ?? 'Sin cuenta'].filter(Boolean).join(' · '),
      icon: debt?.kind === 'owed' ? 'user' : 'scale',
      tone: 'amber',
      amount: m.accountId ? formatSigned(sign * m.amount) : formatMoney(m.amount),
      amountClass: !m.accountId ? 'neutral' : sign > 0 ? 'pos' : '',
    };
  }
  const category = categories.get(m.categoryId);
  return {
    title: category?.name ?? 'Sin categoría',
    subtitle: [note, account?.name].filter(Boolean).join(' · '),
    icon: category?.icon ?? 'tag',
    tone: category?.color ?? 'gray',
    amount: formatSigned(m.type === 'expense' ? -m.amount : m.amount),
    amountClass: m.type === 'income' ? 'pos' : '',
  };
}

/** Mapas de búsqueda rápida por id para pintar listas. */
export function lookups(state) {
  return {
    accounts: new Map(state.accounts.map((a) => [a.id, a])),
    categories: new Map(state.categories.map((c) => [c.id, c])),
    debts: new Map(state.debts.map((d) => [d.id, d])),
  };
}
