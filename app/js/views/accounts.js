// Cuentas: lista (con orden y archivadas) y hoja para crear o editar una cuenta.

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  section, list, row, tile, field, textInput, amountInput, segmented, iconPicker, colorPicker, toggleRow, errorText, emptyState,
} from '../ui/components.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { rerender } from '../ui/shell.js';
import { registerViewReset } from '../ui/session.js';
import * as store from '../core/store.js';
import { ValidationError, LIMITS } from '../core/model.js';
import { ACCOUNT_TYPES, accountTypeInfo } from '../core/catalog.js';
import { cleanLetters } from '../core/text.js';
import { accountRow, moveButtons } from './shared.js';

let sorting = false;
registerViewReset(() => {
  sorting = false;
});

export function accountsView() {
  const state = store.getState();
  const balances = store.derived().summary.balances;
  const active = state.accounts.filter((a) => !a.archived);
  const archived = state.accounts.filter((a) => a.archived);
  const rows = active.map((account, i) => (sorting
    ? row({ lead: tile(account), title: account.name, trailing: moveButtons(active, i, (ids) => store.reorderAccounts(ids)) })
    : accountRow(account, balances.get(account.id) ?? 0, { chevron: true, onClick: () => openAccountForm({ account }) })));

  return {
    title: 'Cuentas',
    back: { label: 'Más', path: '/mas' },
    actions: active.length > 1
      ? [h('button', { type: 'button', class: 'btn-text', onClick: () => { sorting = !sorting; rerender(); } }, sorting ? 'Hecho' : 'Ordenar')]
      : [],
    body: [
      active.length
        ? section({ caption: sorting ? 'Usa las flechas para cambiar el orden.' : 'Toca una cuenta para cambiar su nombre, símbolo, color o saldo.' }, list(rows))
        : h('div', { class: 'card' }, emptyState('building-bank', 'Sin cuentas activas', 'Añade tu banco, tarjeta, efectivo o ahorro.')),
      h('button', { type: 'button', class: 'btn', onClick: () => openAccountForm() }, icon('plus'), 'Nueva cuenta'),
      archived.length
        ? section({ title: 'Archivadas', caption: 'No aparecen al elegir cuenta, pero conservan su historial.' },
          list(archived.map((account) => accountRow(account, balances.get(account.id) ?? 0, { chevron: true, onClick: () => openAccountForm({ account }) }))))
        : null,
    ],
  };
}

export function openAccountForm({ account = null } = {}) {
  const editing = account !== null;
  const balance = editing ? store.derived().summary.balances.get(account.id) ?? 0 : 0;
  const draft = {
    type: account?.type ?? 'bank',
    icon: account?.icon ?? 'building-bank',
    color: account?.color ?? 'blue',
    mode: account?.letters ? 'letters' : 'icon',
    includeInTotal: account?.includeInTotal ?? true,
    archived: account?.archived ?? false,
  };

  const preview = h('div', { class: 'preview' });
  const name = textInput({ value: account?.name ?? '', placeholder: 'Por ejemplo: BBVA nómina', maxLength: LIMITS.name, capitalize: 'words' });
  const letters = textInput({ value: account?.letters ?? '', placeholder: 'BBVA', maxLength: 4, capitalize: 'characters', label: 'Iniciales' });
  const amount = amountInput({ value: balance, label: 'Saldo actual', allowNegative: true, allowZero: true, compact: true });
  const error = errorText();
  const makeIcons = () => iconPicker(draft.icon, draft.color, (value) => { draft.icon = value; refresh(); });
  let icons = makeIcons();
  const symbolBox = h('div');

  function refresh() {
    replace(preview, tile({ icon: draft.icon, color: draft.color, letters: draft.mode === 'letters' ? cleanLetters(letters.value) || '?' : '' }, 'lg'));
  }
  const renderSymbol = () => replace(symbolBox, draft.mode === 'letters'
    ? field('Iniciales (hasta 4)', letters, { help: 'Por ejemplo BBVA, ING o CX.' })
    : field('Símbolo', icons.el));
  letters.addEventListener('input', refresh);
  refresh();
  renderSymbol();

  const typeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tipo de cuenta' });
  for (const type of ACCOUNT_TYPES) {
    const button = h('button', { type: 'button', class: 'chip text-only', 'aria-pressed': String(type.key === draft.type) }, type.label);
    button.addEventListener('click', () => {
      for (const b of typeChips.children) b.setAttribute('aria-pressed', String(b === button));
      if (draft.icon === accountTypeInfo(draft.type).icon) {
        draft.icon = type.icon; // el símbolo sigue al tipo mientras no se haya elegido otro
        icons = makeIcons();
      }
      draft.type = type.key;
      renderSymbol();
      refresh();
    });
    typeChips.append(button);
  }

  const save = () => {
    error.textContent = '';
    const cents = amount.read();
    if (cents === null) return;
    const initials = cleanLetters(letters.value);
    if (draft.mode === 'letters' && !initials) {
      error.textContent = 'Escribe las iniciales o elige un símbolo.';
      return;
    }
    const data = {
      name: name.value,
      type: draft.type,
      icon: draft.icon,
      letters: draft.mode === 'letters' ? initials : '',
      color: draft.color,
      includeInTotal: draft.includeInTotal,
      archived: draft.archived,
    };
    try {
      if (editing) {
        store.updateAccount(account.id, data);
        if (cents !== balance) store.setAccountBalance(account.id, cents);
        toast('Cuenta guardada');
      } else {
        store.addAccount({ ...data, initial: cents });
        toast('Cuenta creada');
      }
      sheet.close();
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };

  const remove = async () => {
    const usage = store.accountUsage(account.id);
    const details = usage.movements
      ? `Se borrarán sus ${usage.movements} movimientos (gastos, ingresos y transferencias); los pagos de deudas se conservarán sin cuenta.`
      : 'Esta cuenta no tiene movimientos.';
    const confirmed = await confirmDialog({
      title: `¿Borrar «${account.name}»?`,
      text: `${details}${usage.recurring ? ` También se borrarán ${usage.recurring} programados.` : ''} Si solo quieres ocultarla, archívala.`,
      confirmLabel: 'Borrar',
      danger: true,
    });
    if (!confirmed) return;
    store.deleteAccount(account.id);
    sheet.close();
    toast('Cuenta borrada');
  };

  const sheet = openSheet({
    title: editing ? 'Editar cuenta' : 'Nueva cuenta',
    tall: true,
    primary: { label: 'Guardar', onClick: save },
    focus: editing ? null : name,
    body: [
      preview,
      field('Nombre', name),
      field('Tipo', typeChips),
      segmented([{ value: 'icon', label: 'Símbolo' }, { value: 'letters', label: 'Iniciales' }], draft.mode, (value) => {
        draft.mode = value;
        renderSymbol();
        refresh();
      }, { label: 'Mostrar' }),
      symbolBox,
      field('Color', colorPicker(draft.color, (value) => { draft.color = value; icons.setColor(value); refresh(); })),
      field('Saldo actual', amount.el, { input: amount.input, help: editing ? 'Si lo cambias, se ajusta el saldo de partida; tus movimientos no cambian.' : 'Lo que tienes ahora mismo en esta cuenta.' }),
      list([
        toggleRow('Sumar al total', draft.includeInTotal, (checked) => { draft.includeInTotal = checked; }, { help: 'Desactívalo, por ejemplo, para inversiones que no son dinero disponible.' }),
        editing ? toggleRow('Archivada', draft.archived, (checked) => { draft.archived = checked; }, { help: 'Se oculta al elegir cuenta, pero conserva su historial.' }) : null,
      ], { plain: true }),
      error,
      h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
      editing ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar cuenta') : null,
    ],
  });
}
