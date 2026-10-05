// Hoja para añadir o editar un gasto, ingreso o transferencia (con opción de repetirlo).

import { h, replace } from '../ui/dom.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import {
  amountInput, segmented, categoryGrid, chipPicker, field, dateInput, readDate, textInput, errorText, emptyState,
} from '../ui/components.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import { ValidationError, LIMITS } from '../core/model.js';
import { todayISO, addDays } from '../core/dates.js';
import { countDue } from '../core/recurring.js';
import { openDebtMovementForm } from './debt-forms.js';

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Gasto' },
  { value: 'income', label: 'Ingreso' },
  { value: 'transfer', label: 'Transferencia' },
];
const REPEAT_OPTIONS = [
  { value: null, label: 'No' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensual' },
  { value: 'yearly', label: 'Anual' },
];
const SAVED = { expense: 'Gasto guardado', income: 'Ingreso guardado', transfer: 'Transferencia guardada' };

/** Cuentas que se pueden elegir: activas, más la del movimiento si estuviera archivada. */
export function selectableAccounts(state, ...keepIds) {
  return state.accounts.filter((a) => !a.archived || keepIds.includes(a.id));
}

export function selectableCategories(state, kind, keepId = null) {
  return state.categories.filter((c) => c.kind === kind && (!c.archived || c.id === keepId));
}

export function openMovementForm({ movement = null, preset = {} } = {}) {
  if (movement?.type === 'debt') {
    const debt = store.getState().debts.find((d) => d.id === movement.debtId);
    if (debt) openDebtMovementForm({ debt, movement });
    return;
  }
  const state = store.getState();
  const editing = movement !== null;
  const accounts = selectableAccounts(state, movement?.accountId, movement?.toAccountId);
  if (accounts.length === 0) {
    const sheet = openSheet({
      title: 'Nuevo movimiento',
      body: emptyState('building-bank', 'Primero crea una cuenta', 'Los movimientos siempre salen o entran en una de tus cuentas.', {
        label: 'Ir a cuentas',
        onClick: () => {
          sheet.close();
          router.navigate('/mas/cuentas');
        },
      }),
    });
    return;
  }
  const fallbackAccount = accounts.find((a) => a.id === state.settings.lastAccountId)?.id ?? accounts[0].id;
  const draft = {
    type: movement?.type ?? preset.type ?? 'expense',
    categoryId: movement?.categoryId ?? null,
    accountId: movement?.accountId ?? (accounts.some((a) => a.id === preset.accountId) ? preset.accountId : fallbackAccount),
    toAccountId: movement?.toAccountId ?? null,
    repeat: null,
  };

  const amount = amountInput({ value: movement?.amount ?? null });
  const dynamic = h('div', { class: 'form' });
  const date = dateInput(movement?.date ?? todayISO());
  const note = textInput({ value: movement?.note ?? '', placeholder: 'Opcional', maxLength: LIMITS.note });
  const error = errorText();

  const renderDynamic = () => {
    if (draft.type === 'transfer') {
      if (draft.toAccountId === draft.accountId) draft.toAccountId = null;
      replace(dynamic,
        field('Desde', chipPicker(accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta de origen' })),
        field('Hacia', chipPicker(accounts, draft.toAccountId, (id) => { draft.toAccountId = id; }, { label: 'Cuenta de destino' })));
      return;
    }
    const categories = selectableCategories(state, draft.type, movement?.categoryId);
    if (!categories.some((c) => c.id === draft.categoryId)) draft.categoryId = null;
    replace(dynamic,
      field('Categoría', categories.length
        ? categoryGrid(categories, draft.categoryId, (id) => { draft.categoryId = id; error.textContent = ''; })
        : h('p', { class: 'help' }, 'No tienes categorías de este tipo. Créalas en Más → Categorías.')),
      field('Cuenta', chipPicker(accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta' })));
  };
  renderDynamic();

  const repeatInfo = h('p', { class: 'help', 'aria-live': 'polite' });
  const updateRepeatInfo = () => {
    const day = readDate(date);
    const n = draft.repeat && day ? countDue({ frequency: draft.repeat, interval: 1, startDate: day, endDate: null }, todayISO()) : 0;
    repeatInfo.textContent = n > 1 ? `Como la fecha es pasada, al guardar se crearán ${n} movimientos (uno por cada vez hasta hoy).` : '';
  };
  date.addEventListener('change', updateRepeatInfo);

  const quickDates = h('div', { class: 'quick' },
    h('button', { type: 'button', class: 'chip text-only', onClick: () => { date.value = todayISO(); updateRepeatInfo(); } }, 'Hoy'),
    h('button', { type: 'button', class: 'chip text-only', onClick: () => { date.value = addDays(todayISO(), -1); updateRepeatInfo(); } }, 'Ayer'));

  const save = () => {
    error.textContent = '';
    const cents = amount.read();
    const day = readDate(date);
    if (cents === null) {
      amount.input.focus();
      return;
    }
    if (!day) {
      error.textContent = 'Elige una fecha.';
      return;
    }
    if (draft.type !== 'transfer' && !draft.categoryId) {
      error.textContent = 'Elige una categoría.';
      return;
    }
    if (draft.type === 'transfer' && (!draft.toAccountId || draft.toAccountId === draft.accountId)) {
      error.textContent = 'Elige una cuenta de destino distinta de la de origen.';
      return;
    }
    const data = {
      type: draft.type,
      amount: cents,
      date: day,
      accountId: draft.accountId,
      toAccountId: draft.type === 'transfer' ? draft.toAccountId : undefined,
      categoryId: draft.type === 'transfer' ? undefined : draft.categoryId,
      note: note.value,
    };
    try {
      if (editing) {
        store.updateMovement(movement.id, data);
        toast('Cambios guardados');
      } else if (draft.repeat) {
        const { date: nextDate, ...template } = data;
        const { created } = store.addRecurring({ frequency: draft.repeat, interval: 1, nextDate, endDate: null, active: true, template });
        toast(created ? `Programado. Se ${created === 1 ? 'ha añadido 1 movimiento' : `han añadido ${created} movimientos`}.` : 'Programado. Se añadirá en su fecha.');
      } else {
        const created = store.addMovement(data);
        toast(SAVED[draft.type], { action: { label: 'Deshacer', onClick: () => store.deleteMovement(created.id) } });
      }
      sheet.close();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };

  const remove = () => {
    const removed = store.deleteMovement(movement.id);
    sheet.close();
    if (removed) toast('Movimiento borrado', { action: { label: 'Deshacer', onClick: () => store.restoreMovement(removed) } });
  };

  const body = [
    segmented(TYPE_OPTIONS, draft.type, (type) => { draft.type = type; renderDynamic(); }, { label: 'Tipo de movimiento' }),
    amount.el,
    dynamic,
    field('Fecha', date, { input: date }),
    quickDates,
    field('Nota', note),
    editing ? null : field('Repetir', segmented(REPEAT_OPTIONS, null, (value) => { draft.repeat = value; updateRepeatInfo(); }, { label: 'Repetir' }), {
      help: 'Si eliges una frecuencia, se creará solo en cada fecha (lo verás en Más → Programados).',
    }),
    editing ? null : repeatInfo,
    error,
    h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
    editing ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar movimiento') : null,
    movement?.recurringId ? h('p', { class: 'help' }, 'Este movimiento se creó desde un programado. Editarlo no cambia los siguientes.') : null,
  ];

  const sheet = openSheet({
    title: editing ? 'Editar movimiento' : 'Nuevo movimiento',
    body,
    primary: { label: 'Guardar', onClick: save },
    tall: true,
    focus: editing ? null : amount.input,
  });
}
