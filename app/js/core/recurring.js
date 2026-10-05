// Movimientos programados (recurrentes): cálculo de fechas sin deriva.
// La ocurrencia k se calcula siempre desde la fecha de inicio (inicio + k·intervalo), nunca desde
// la anterior: así una cuota del día 31 cae el 28/29 en febrero y vuelve al 31 en marzo.

import { addDays, addMonths, parseISO } from './dates.js';

export const MAX_GENERATED_PER_RUN = 500;

/**
 * Fecha de la ocurrencia número `index` (0 = fecha de inicio). `anchorDay` (opcional) conserva un
 * día 29-31 cuando la regla se reancló en un fin de mes recortado (p. ej. el 28 de febrero).
 */
export function occurrenceDate(rule, index) {
  const steps = index * rule.interval;
  if (rule.frequency === 'weekly') return addDays(rule.startDate, 7 * steps);
  const anchor = rule.anchorDay ?? undefined;
  if (rule.frequency === 'monthly') return addMonths(rule.startDate, steps, anchor);
  return addMonths(rule.startDate, 12 * steps, anchor); // yearly
}

const anchorOf = (rule) => rule.anchorDay ?? parseISO(rule.startDate).d;

/** Fecha que se muestra como «próxima» al editar: en una regla pausada, la de su reanudación. */
export function displayedNextDate(rule, today) {
  return rule.active ? nextDate(rule) : occurrenceDate(rule, firstIndexFrom(rule, today));
}

/**
 * Regla resultante de editar `current` con los datos del formulario (función pura: la usan el
 * almacén al guardar y el formulario para avisar de lo que va a pasar, así nunca discrepan).
 * input: { active, frequency, interval, nextDate, endDate, template, shownNextDate }
 * - Solo se reancla si cambia la frecuencia, el intervalo o la fecha respecto a la que se MOSTRÓ
 *   (si mientras tanto se generó una ocurrencia, no se duplica).
 * - Al reanclar en la misma fecha mostrada se conserva el día de anclaje (29-31).
 * - Al reanudar no se recuperan las fechas que pasaron durante la pausa.
 */
export function planRecurringUpdate(current, input, today) {
  const shown = input.shownNextDate ?? displayedNextDate(current, today);
  const dateChanged = input.nextDate !== shown;
  const scheduleChanged = dateChanged || input.frequency !== current.frequency || input.interval !== current.interval;
  const rule = {
    ...current,
    active: input.active !== false,
    frequency: input.frequency,
    interval: input.interval,
    endDate: input.endDate ?? null,
    template: input.template,
  };
  if (scheduleChanged) {
    rule.startDate = input.nextDate;
    rule.index = 0;
    const keepAnchor = !dateChanged && rule.frequency !== 'weekly' && current.frequency !== 'weekly';
    const anchor = keepAnchor ? anchorOf(current) : null;
    rule.anchorDay = anchor && anchor !== parseISO(input.nextDate).d ? anchor : null;
  }
  if (rule.active && !current.active) rule.index = firstIndexFrom(rule, today);
  return rule;
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
