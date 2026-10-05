// Programados: movimientos que se crean solos (alquiler, nómina, suscripciones, cuotas…).

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  list, row, tile, field, amountInput, segmented, chipPicker, categoryGrid, dateInput, readDate, textInput,
  errorText, toggleRow, stepper, emptyState,
} from '../ui/components.js';
import { lookups, describeMovement, frequencyLabel, shortDate } from '../ui/format.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import * as store from '../core/store.js';
import { ValidationError, LIMITS, MAX_INTERVAL } from '../core/model.js';
import { todayISO } from '../core/dates.js';
import { nextDate, isFinished, dueOccurrences, displayedNextDate, planRecurringUpdate } from '../core/recurring.js';
import { selectableAccounts, selectableCategories } from './movement-form.js';

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Transfer.' },
  { value: 'debt', label: 'Deuda' },
];
const FREQUENCY_OPTIONS = [
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'yearly', label: 'Anual' },
];

function status(rule) {
  if (isFinished(rule)) return 'Terminado';
  if (!rule.active) return 'En pausa';
  return `Próximo: ${shortDate(nextDate(rule))}`;
}

export function recurringView() {
  const state = store.getState();
  const look = lookups(state);
  const rules = [...state.recurring].sort((a, b) => {
    const rank = (r) => (isFinished(r) ? 2 : r.active ? 0 : 1);
    return rank(a) - rank(b) || nextDate(a).localeCompare(nextDate(b));
  });
  return {
    title: 'Programados',
    back: { label: 'Más', path: '/mas' },
    body: [
      h('p', { class: 'caption' }, 'Se crean solos al abrir la app cuando llega su fecha. Útil para alquiler, nómina, suscripciones o cuotas de préstamos.'),
      rules.length
        ? list(rules.map((rule) => {
          const info = describeMovement({ ...rule.template, date: rule.startDate }, look);
          return row({
            lead: tile({ icon: info.icon, color: info.tone }),
            title: rule.template.note || info.title,
            subtitle: `${frequencyLabel(rule.frequency, rule.interval)} · ${status(rule)}`,
            value: info.amount,
            valueClass: rule.active ? info.amountClass : 'neutral',
            chevron: true,
            onClick: () => openRecurringForm({ rule }),
          });
        }))
        : h('div', { class: 'card' }, emptyState('repeat', 'Sin programados', 'También puedes crear uno al apuntar un movimiento, con la opción «Repetir».')),
      h('button', { type: 'button', class: 'btn', onClick: () => openRecurringForm() }, icon('plus'), 'Nuevo programado'),
    ],
  };
}

export function openRecurringForm({ rule = null } = {}) {
  const state = store.getState();
  const editing = rule !== null;
  const t = rule?.template;
  const accounts = selectableAccounts(state, t?.accountId, t?.toAccountId);
  const debts = state.debts;
  const today = todayISO();
  const defaultAccount = accounts.find((a) => a.id === state.settings.lastAccountId)?.id ?? accounts[0]?.id ?? null;
  const draft = {
    type: t?.type ?? 'expense',
    categoryId: t?.categoryId ?? null,
    // Al editar se respeta la cuenta guardada, también «Ninguna» (null) en las cuotas de deudas.
    accountId: editing ? t.accountId : defaultAccount,
    toAccountId: t?.toAccountId ?? null,
    debtId: t?.debtId ?? debts[0]?.id ?? null,
    flow: t?.flow ?? 'pay',
    frequency: rule?.frequency ?? 'monthly',
    interval: rule?.interval ?? 1,
    hasEnd: !!rule?.endDate,
    active: rule?.active ?? true,
  };

  const amount = amountInput({ value: t?.amount ?? null });
  const dynamic = h('div', { class: 'form' });
  // La fecha mostrada: en una regla en pausa, aquella en la que se reanudaría.
  const shownNext = rule ? displayedNextDate(rule, today) : today;
  const next = dateInput(shownNext);
  const end = dateInput(rule?.endDate ?? '');
  end.setAttribute('aria-label', 'Fecha de fin');
  end.hidden = !draft.hasEnd;
  const note = textInput({ value: t?.note ?? '', placeholder: 'Por ejemplo: Alquiler', maxLength: LIMITS.note });
  const dueInfo = h('p', { class: 'help', 'aria-live': 'polite' });
  const error = errorText();

  const schedule = (day) => ({
    active: draft.active,
    frequency: draft.frequency,
    interval: draft.interval,
    nextDate: day,
    endDate: draft.hasEnd ? readDate(end) : null,
    shownNextDate: shownNext,
  });
  /** Lo que pasará al guardar, calculado con la misma función que usa el almacén. */
  const updateDueInfo = () => {
    const day = readDate(next);
    if (!day) {
      dueInfo.textContent = '';
      return;
    }
    const input = { ...schedule(day), template: t ?? {} };
    const planned = editing ? planRecurringUpdate(rule, input, today) : { ...input, startDate: day, index: 0, anchorDay: null };
    if (!planned.active) {
      dueInfo.textContent = 'En pausa: no se creará ningún movimiento hasta que lo reactives.';
      return;
    }
    if (planned.endDate && nextDate(planned) > planned.endDate) {
      dueInfo.textContent = 'Con esta fecha de fin ya no se creará ningún movimiento más.';
      return;
    }
    const n = dueOccurrences([planned], today).length;
    dueInfo.textContent = n === 0
      ? `El próximo se creará el ${shortDate(nextDate(planned))}.`
      : n === 1 ? 'Al guardar se creará 1 movimiento (el de esa fecha).' : `Al guardar se crearán ${n} movimientos con fechas ya pasadas.`;
  };
  next.addEventListener('change', updateDueInfo);
  end.addEventListener('change', updateDueInfo);

  const renderDynamic = () => {
    if (draft.type === 'transfer') {
      replace(dynamic,
        field('Desde', chipPicker(accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta de origen' })),
        field('Hacia', chipPicker(accounts, draft.toAccountId, (id) => { draft.toAccountId = id; }, { label: 'Cuenta de destino' })));
    } else if (draft.type === 'debt') {
      replace(dynamic, debts.length
        ? [
          field('Deuda', chipPicker(debts.map((d) => ({ id: d.id, name: d.name, icon: 'scale', color: 'amber' })), draft.debtId, (id) => { draft.debtId = id; }, { label: 'Deuda' })),
          segmented([{ value: 'pay', label: 'Pago o cobro' }, { value: 'add', label: 'Aumento' }], draft.flow, (value) => { draft.flow = value; }, { label: 'Operación' }),
          field('Cuenta (opcional)', chipPicker(accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta', none: 'Ninguna' })),
        ]
        : h('p', { class: 'help' }, 'Primero crea una deuda en la pestaña Deudas.'));
    } else {
      const categories = selectableCategories(state, draft.type, t?.categoryId);
      if (!categories.some((c) => c.id === draft.categoryId)) draft.categoryId = null;
      replace(dynamic,
        field('Categoría', categoryGrid(categories, draft.categoryId, (id) => { draft.categoryId = id; })),
        field('Cuenta', chipPicker(accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta' })));
    }
  };
  renderDynamic();
  updateDueInfo();

  const save = () => {
    error.textContent = '';
    const cents = amount.read();
    const day = readDate(next);
    const endDay = draft.hasEnd ? readDate(end) : null;
    if (cents === null) return;
    if (!day) return void (error.textContent = 'Elige la fecha del próximo movimiento.');
    // Una regla ya terminada se puede editar (nota, importe…) sin tocar sus fechas.
    const keepsFinished = editing && day === shownNext && endDay === rule.endDate;
    if (draft.hasEnd && (!endDay || (endDay < day && !keepsFinished))) return void (error.textContent = 'La fecha de fin debe ser posterior a la próxima fecha.');
    if ((draft.type === 'expense' || draft.type === 'income') && !draft.categoryId) return void (error.textContent = 'Elige una categoría.');
    if (draft.type === 'transfer' && (!draft.toAccountId || draft.toAccountId === draft.accountId)) return void (error.textContent = 'Elige una cuenta de destino distinta.');
    if (draft.type === 'debt' && !draft.debtId) return void (error.textContent = 'Elige una deuda.');
    if (draft.type !== 'debt' && !draft.accountId) return void (error.textContent = 'Elige una cuenta.');
    const template = {
      type: draft.type,
      amount: cents,
      accountId: draft.accountId,
      toAccountId: draft.type === 'transfer' ? draft.toAccountId : undefined,
      categoryId: draft.type === 'expense' || draft.type === 'income' ? draft.categoryId : undefined,
      debtId: draft.type === 'debt' ? draft.debtId : undefined,
      flow: draft.type === 'debt' ? draft.flow : undefined,
      note: note.value,
    };
    const input = { ...schedule(day), template };
    try {
      const { created } = editing ? store.updateRecurring(rule.id, input) : store.addRecurring(input);
      sheet.close();
      toast(created ? `Guardado. Se ${created === 1 ? 'ha creado 1 movimiento' : `han creado ${created} movimientos`}.` : 'Programado guardado');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };

  const remove = async () => {
    const confirmed = await confirmDialog({
      title: '¿Borrar este programado?',
      text: 'Dejarán de crearse movimientos nuevos. Los que ya se crearon se conservan.',
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (!confirmed) return;
    store.deleteRecurring(rule.id);
    sheet.close();
    toast('Programado borrado');
  };

  const sheet = openSheet({
    title: editing ? 'Editar programado' : 'Nuevo programado',
    tall: true,
    primary: { label: 'Guardar', onClick: save },
    focus: editing ? null : amount.input,
    body: [
      segmented(TYPE_OPTIONS, draft.type, (value) => { draft.type = value; renderDynamic(); }, { label: 'Tipo' }),
      amount.el,
      dynamic,
      field('Frecuencia', segmented(FREQUENCY_OPTIONS, draft.frequency, (value) => { draft.frequency = value; updateDueInfo(); }, { label: 'Frecuencia' })),
      h('div', { class: 'switch-row card' },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Repetir cada'), h('span', { class: 'row-sub' }, '1 = cada semana, mes o año')),
        stepper(draft.interval, { min: 1, max: MAX_INTERVAL, label: 'Intervalo', onChange: (value) => { draft.interval = value; updateDueInfo(); } })),
      field(editing ? 'Próxima fecha' : 'Primera fecha', next, { input: next }),
      dueInfo,
      list([toggleRow('Tiene fecha de fin', draft.hasEnd, (checked) => { draft.hasEnd = checked; end.hidden = !checked; if (checked && !end.value) end.value = readDate(next) ?? todayISO(); updateDueInfo(); })], { plain: true }),
      end,
      field('Nota', note, { help: 'Se usa como nombre en la lista (por ejemplo «Netflix» o «Alquiler»).' }),
      editing ? list([toggleRow('Activo', draft.active, (checked) => { draft.active = checked; updateDueInfo(); }, { help: 'Si lo pausas, al reanudarlo no se crean las fechas que pasaron.' })], { plain: true }) : null,
      error,
      h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
      editing ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar programado') : null,
    ],
  });
}
