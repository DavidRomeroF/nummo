// Movimientos programados (recurrentes): cálculo de fechas sin deriva.
// La ocurrencia k se calcula siempre desde la fecha de inicio (inicio + k·intervalo), nunca desde
// la anterior: así una cuota del día 31 cae el 28/29 en febrero y vuelve al 31 en marzo.

import { addDays, addMonths } from './dates.js';

export const MAX_GENERATED_PER_RUN = 500;

/** Fecha de la ocurrencia número `index` (0 = fecha de inicio). */
export function occurrenceDate(rule, index) {
  const steps = index * rule.interval;
  if (rule.frequency === 'weekly') return addDays(rule.startDate, 7 * steps);
  if (rule.frequency === 'monthly') return addMonths(rule.startDate, steps);
  return addMonths(rule.startDate, 12 * steps); // yearly
}

export const nextDate = (rule) => occurrenceDate(rule, rule.index);

export function isFinished(rule) {
  return rule.endDate !== null && nextDate(rule) > rule.endDate;
}

/**
 * Ocurrencias pendientes (fecha ≤ `today`) de las reglas activas, en orden por regla:
 * [{ rule, date }]. Con un tope por ejecución para que una fecha errónea no cree miles de movimientos.
 */
export function dueOccurrences(rules, today, limit = MAX_GENERATED_PER_RUN) {
  const items = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    for (let index = rule.index; items.length < limit; index += 1) {
      const date = occurrenceDate(rule, index);
      if (date > today || (rule.endDate !== null && date > rule.endDate)) break;
      items.push({ rule, date });
    }
  }
  return items;
}

/** Primer índice cuya fecha es ≥ `today` (al reactivar una regla no se recuperan las pausadas). */
export function firstIndexFrom(rule, today) {
  let index = rule.index;
  while (index < rule.index + 100_000 && occurrenceDate(rule, index) < today) index += 1;
  return index;
}

/** Cuántas ocurrencias se crearían ya mismo al guardar una regla (aviso en el formulario). */
export function countDue(rule, today, cap = MAX_GENERATED_PER_RUN) {
  return dueOccurrences([{ ...rule, active: true, index: 0 }], today, cap).length;
}
