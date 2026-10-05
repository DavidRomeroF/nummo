// Presupuestos mensuales: total del mes y por categoría de gasto.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, amountInput, errorText, categoryGrid, emptyState } from '../ui/components.js';
import { lookups, monthLabel } from '../ui/format.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import * as store from '../core/store.js';
import { ValidationError } from '../core/model.js';
import { currentMonthKey } from '../core/dates.js';
import { BUDGET_WARN_RATIO } from '../core/finance.js';
import { budgetItem } from './shared.js';

const editable = (b, category) => budgetItem(b, category, { onClick: () => openBudgetForm({ categoryId: b.categoryId, amount: b.amount }) });

export function budgetsView() {
  const state = store.getState();
  const look = lookups(state);
  const monthKey = currentMonthKey();
  const statuses = store.derived().budgets(monthKey);
  const total = statuses.find((b) => b.categoryId === null);
  const perCategory = statuses.filter((b) => b.categoryId !== null);

  return {
    title: 'Presupuestos',
    back: { label: 'Más', path: '/mas' },
    body: [
      h('p', { class: 'caption' }, `Límites que se reinician cada mes. Datos de ${monthLabel(monthKey)}. Te aviso al llegar al ${Math.round(BUDGET_WARN_RATIO * 100)} %.`),
      section({ title: 'Total del mes' },
        total
          ? list([editable(total, null)])
          : h('button', { type: 'button', class: 'btn', onClick: () => openBudgetForm({ categoryId: null }) }, icon('plus'), 'Fijar un límite total')),
      section({ title: 'Por categoría' },
        perCategory.length
          ? list(perCategory.map((b) => editable(b, look.categories.get(b.categoryId))))
          : h('div', { class: 'card' }, emptyState('target', 'Sin presupuestos por categoría', 'Por ejemplo: 300 € al mes en restaurantes.')),
        h('button', { type: 'button', class: 'btn', onClick: chooseCategory }, icon('plus'), 'Añadir presupuesto')),
    ],
  };
}

function chooseCategory() {
  const state = store.getState();
  const withBudget = new Set(state.budgets.map((b) => b.categoryId));
  const options = state.categories.filter((c) => c.kind === 'expense' && !c.archived && !withBudget.has(c.id));
  const sheet = openSheet({
    title: 'Elige una categoría',
    tall: true,
    body: options.length
      ? categoryGrid(options, null, (id) => {
        sheet.close();
        openBudgetForm({ categoryId: id });
      }, { label: 'Categoría' })
      : emptyState('circle-check', 'Todas tus categorías tienen presupuesto'),
  });
}

function openBudgetForm({ categoryId, amount = null }) {
  const category = store.getState().categories.find((c) => c.id === categoryId);
  const input = amountInput({ value: amount, label: 'Límite mensual' });
  const error = errorText();
  const save = () => {
    const cents = input.read();
    if (cents === null) return;
    try {
      store.setBudget(categoryId, cents);
      sheet.close();
      toast('Presupuesto guardado');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };
  const sheet = openSheet({
    title: category ? category.name : 'Total del mes',
    primary: { label: 'Guardar', onClick: save },
    focus: input.input,
    body: [
      h('p', { class: 'help' }, category ? '¿Cuánto quieres gastar como mucho al mes en esta categoría?' : '¿Cuánto quieres gastar como mucho al mes en total?'),
      input.el,
      error,
      h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
      amount !== null
        ? h('button', { type: 'button', class: 'btn danger', onClick: () => { store.setBudget(categoryId, null); sheet.close(); toast('Presupuesto quitado'); } }, 'Quitar presupuesto')
        : null,
    ],
  });
}
