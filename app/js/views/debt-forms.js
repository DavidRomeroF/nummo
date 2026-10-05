// Hojas de deudas: crear/editar una deuda y registrar pagos, cobros o aumentos.

import { h } from '../ui/dom.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import {
  amountInput, segmented, chipPicker, field, dateInput, readDate, textInput, errorText, toggleRow, list,
} from '../ui/components.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import { ValidationError, LIMITS } from '../core/model.js';
import { todayISO } from '../core/dates.js';
import { formatMoney } from '../core/money.js';
import { computeDebtTotals } from '../core/finance.js';

const KIND_OPTIONS = [
  { value: 'owe', label: 'Debo' },
  { value: 'owed', label: 'Me deben' },
];

const accountsFor = (state, keepId) => state.accounts.filter((a) => !a.archived || a.id === keepId);

/** Nueva deuda (con su importe inicial) o edición de nombre, nota y fecha límite. */
export function openDebtForm({ debt = null, kind = 'owe' } = {}) {
  const state = store.getState();
  const editing = debt !== null;
  const draft = { kind: debt?.kind ?? kind, accountId: null, hasDue: !!debt?.dueDate };

  const nameLabel = h('span');
  const name = textInput({ value: debt?.name ?? '', placeholder: 'Persona o entidad', maxLength: LIMITS.name, capitalize: 'words' });
  const amount = editing ? null : amountInput({ label: 'Importe de la deuda' });
  const date = editing ? null : dateInput(todayISO());
  const accountHelp = h('p', { class: 'help' });
  const due = dateInput(debt?.dueDate ?? '');
  due.hidden = !draft.hasDue;
  const note = textInput({ value: debt?.note ?? '', placeholder: 'Opcional', maxLength: LIMITS.note });
  const error = errorText();

  const refreshTexts = () => {
    nameLabel.textContent = draft.kind === 'owe' ? '¿A quién se lo debes?' : '¿Quién te lo debe?';
    accountHelp.textContent = draft.kind === 'owe'
      ? 'Si ese dinero entró en una de tus cuentas, elígela y su saldo subirá. Si no (por ejemplo, una compra a plazos), deja «Ninguna».'
      : 'Si el dinero salió de una de tus cuentas, elígela y su saldo bajará.';
  };
  refreshTexts();

  const save = () => {
    error.textContent = '';
    const dueDate = draft.hasDue ? readDate(due) : null;
    if (draft.hasDue && !dueDate) {
      error.textContent = 'Elige la fecha límite o desactívala.';
      return;
    }
    try {
      if (editing) {
        store.updateDebt(debt.id, { name: name.value, note: note.value, dueDate });
        toast('Cambios guardados');
        sheet.close();
        return;
      }
      const cents = amount.read();
      const day = readDate(date);
      if (cents === null) return;
      if (!day) {
        error.textContent = 'Elige una fecha.';
        return;
      }
      const created = store.addDebt(
        { kind: draft.kind, name: name.value, note: note.value, dueDate },
        { amount: cents, date: day, accountId: draft.accountId, note: '' },
      );
      sheet.close();
      toast('Deuda guardada');
      router.navigate(`/deudas/${created.id}`);
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };

  const remove = async () => {
    const count = state.movements.filter((m) => m.debtId === debt.id).length;
    const confirmed = await confirmDialog({
      title: `¿Borrar «${debt.name}»?`,
      text: `Se borrarán también sus ${count} movimientos y los saldos de las cuentas vinculadas se recalcularán. No se puede deshacer.`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (!confirmed) return;
    store.deleteDebt(debt.id);
    sheet.close();
    router.navigate('/deudas', { replace: true });
    toast('Deuda borrada');
  };

  const body = [
    editing ? null : segmented(KIND_OPTIONS, draft.kind, (value) => { draft.kind = value; refreshTexts(); }, { label: 'Tipo de deuda' }),
    field(nameLabel, name),
    amount?.el,
    date ? field('Fecha', date) : null,
    editing ? null : h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Cuenta (opcional)'),
      chipPicker(accountsFor(state), null, (id) => { draft.accountId = id; }, { label: 'Cuenta', none: 'Ninguna' }),
      accountHelp),
    list([toggleRow('Tiene fecha límite', draft.hasDue, (checked) => { draft.hasDue = checked; due.hidden = !checked; if (checked && !due.value) due.value = todayISO(); })], { plain: true }),
    due,
    field('Nota', note),
    error,
    h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
    editing ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar deuda') : null,
  ];
  const sheet = openSheet({
    title: editing ? 'Editar deuda' : 'Nueva deuda',
    body,
    primary: { label: 'Guardar', onClick: save },
    tall: true,
    focus: editing ? null : name,
  });
}

const FLOW_TITLES = {
  'owe:pay': 'Registrar pago',
  'owed:pay': 'Registrar cobro',
  'owe:add': 'Me han prestado más',
  'owed:add': 'He prestado más',
};

/** Pago/cobro (flow 'pay') o aumento (flow 'add') de una deuda; también edita uno existente. */
export function openDebtMovementForm({ debt, flow = 'pay', movement = null }) {
  const state = store.getState();
  const editing = movement !== null;
  const currentFlow = movement?.flow ?? flow;
  const pending = computeDebtTotals(state).get(debt.id)?.pending ?? 0;
  const accounts = accountsFor(state, movement?.accountId);
  const defaultAccount = currentFlow === 'pay' && accounts.some((a) => a.id === state.settings.lastAccountId) ? state.settings.lastAccountId : null;
  const draft = { accountId: editing ? movement.accountId : defaultAccount };

  const amount = amountInput({ value: movement?.amount ?? null });
  const date = dateInput(movement?.date ?? todayISO());
  const note = textInput({ value: movement?.note ?? '', placeholder: 'Opcional', maxLength: LIMITS.note });
  const error = errorText();
  const accountHelp = (debt.kind === 'owe') === (currentFlow === 'pay')
    ? 'Elige la cuenta de la que sale el dinero para que su saldo baje.'
    : 'Elige la cuenta en la que entra el dinero para que su saldo suba.';

  const save = () => {
    error.textContent = '';
    const cents = amount.read();
    const day = readDate(date);
    if (cents === null) return;
    if (!day) {
      error.textContent = 'Elige una fecha.';
      return;
    }
    const data = { type: 'debt', debtId: debt.id, flow: currentFlow, amount: cents, date: day, accountId: draft.accountId, note: note.value };
    try {
      if (editing) store.updateMovement(movement.id, data);
      else store.addMovement(data);
      sheet.close();
      const left = computeDebtTotals(store.getState()).get(debt.id)?.pending ?? 0;
      toast(left <= 0 && currentFlow === 'pay' ? '¡Deuda saldada!' : 'Guardado');
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
    h('p', { class: 'help' }, `${debt.name} · Pendiente: ${formatMoney(Math.max(pending, 0))}`),
    amount.el,
    currentFlow === 'pay' && pending > 0 && !editing
      ? h('div', { class: 'quick' }, h('button', { type: 'button', class: 'chip text-only', onClick: () => amount.set(pending) }, `Todo (${formatMoney(pending)})`))
      : null,
    field('Fecha', date),
    h('div', { class: 'field' },
      h('span', { class: 'field-label' }, 'Cuenta (opcional)'),
      chipPicker(accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta', none: 'Ninguna' }),
      h('p', { class: 'help' }, accountHelp)),
    field('Nota', note),
    error,
    h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
    editing ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar movimiento') : null,
  ];
  const sheet = openSheet({
    title: editing ? 'Editar movimiento' : FLOW_TITLES[`${debt.kind}:${currentFlow}`],
    body,
    primary: { label: 'Guardar', onClick: save },
    tall: true,
    focus: editing ? null : amount.input,
  });
}
