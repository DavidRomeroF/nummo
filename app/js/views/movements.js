// Movimientos: por meses, agrupados por día, con búsqueda (en todo el historial) y filtros.

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { list, monthNav, emptyState, chipPicker, categoryGrid, field, segmented } from '../ui/components.js';
import { lookups, dayLabel } from '../ui/format.js';
import { openSheet } from '../ui/sheet.js';
import { rerender } from '../ui/shell.js';
import { registerViewReset } from '../ui/session.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import { formatSigned, centsToInput } from '../core/money.js';
import { currentMonthKey, monthBounds } from '../core/dates.js';
import { foldText } from '../core/text.js';
import { openMovementForm } from './movement-form.js';
import { compareNewest, movementRow } from './shared.js';

const MAX_SEARCH_RESULTS = 300;
const SEARCH_DELAY_MS = 150;
const NO_FILTERS = { type: null, accountId: null, categoryId: null };
const TYPE_LABELS = { expense: 'Gastos', income: 'Ingresos', transfer: 'Transferencias', debt: 'Deudas' };

let monthKey = currentMonthKey();
let filters = { ...NO_FILTERS };
let query = '';
registerViewReset(() => {
  monthKey = currentMonthKey();
  filters = { ...NO_FILTERS };
  query = '';
});

/** Abre la lista con filtros (p. ej. desde una cuenta del Inicio o una categoría de Análisis). */
export function showMovementsFor(filter, month = currentMonthKey()) {
  filters = { ...NO_FILTERS, ...filter };
  query = '';
  monthKey = month;
  router.navigate('/movimientos', { replace: true });
}

const activeFilterCount = () => Object.values(filters).filter(Boolean).length;

/** Nombres ya normalizados (sin tildes ni mayúsculas), una vez por búsqueda y no por movimiento. */
function foldedNames(look) {
  const fold = (map) => new Map([...map].map(([id, item]) => [id, foldText(item.name)]));
  return { accounts: fold(look.accounts), categories: fold(look.categories), debts: fold(look.debts) };
}

function matches(m, q, names) {
  const fields = [
    names.categories.get(m.categoryId), names.accounts.get(m.accountId), names.accounts.get(m.toAccountId),
    names.debts.get(m.debtId), centsToInput(m.amount),
  ];
  return fields.some((f) => f?.includes(q)) || (m.note !== '' && foldText(m.note).includes(q));
}

function results(state, look) {
  const q = foldText(query.trim());
  let items = state.movements;
  if (!q) {
    const { start, end } = monthBounds(monthKey);
    items = items.filter((m) => m.date >= start && m.date <= end);
  }
  if (filters.type) items = items.filter((m) => m.type === filters.type);
  if (filters.accountId) items = items.filter((m) => m.accountId === filters.accountId || m.toAccountId === filters.accountId);
  if (filters.categoryId) items = items.filter((m) => m.categoryId === filters.categoryId);
  if (q) {
    const names = foldedNames(look);
    items = items.filter((m) => matches(m, q, names));
  }
  items = [...items].sort(compareNewest);
  // El tope solo se aplica a la búsqueda en todo el historial; un mes se muestra siempre completo.
  const truncated = q !== '' && items.length > MAX_SEARCH_RESULTS;
  if (truncated) items = items.slice(0, MAX_SEARCH_RESULTS);

  if (!items.length) {
    return [h('div', { class: 'card' }, q || activeFilterCount()
      ? emptyState('search', 'Sin resultados', 'Prueba con otras palabras o quita los filtros.')
      : emptyState('list-details', 'Sin movimientos este mes', 'Pulsa + para añadir uno.'))];
  }
  const groups = [];
  for (const m of items) {
    if (groups.at(-1)?.date !== m.date) groups.push({ date: m.date, items: [] });
    groups.at(-1).items.push(m);
  }
  const nodes = groups.map((group) => {
    const net = group.items.reduce((sum, m) => sum + (m.type === 'income' ? m.amount : m.type === 'expense' ? -m.amount : 0), 0);
    return h('section', { class: 'section' },
      h('h2', { class: 'day-head' }, h('span', null, dayLabel(group.date)), net ? h('span', { class: 'num' }, formatSigned(net)) : null),
      list(group.items.map((m) => movementRow(m, look))));
  });
  if (q || activeFilterCount()) nodes.unshift(h('p', { class: 'caption' }, `${items.length}${truncated ? '+' : ''} movimientos${q ? ' en todo el historial' : ''}`));
  return nodes;
}

function openFilters() {
  const state = store.getState();
  const draft = { ...filters };
  const typeChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Tipo' });
  const typeOptions = [[null, 'Todos'], ...Object.entries(TYPE_LABELS)];
  for (const [value, label] of typeOptions) {
    const button = h('button', { type: 'button', class: 'chip text-only', 'aria-pressed': String(draft.type === value) }, label);
    button.addEventListener('click', () => {
      for (const b of typeChips.children) b.setAttribute('aria-pressed', String(b === button));
      draft.type = value;
    });
    typeChips.append(button);
  }
  const categories = state.categories.filter((c) => !c.archived || c.id === draft.categoryId);
  const kindSwitch = h('div');
  const categoryBox = h('div');
  let kind = categories.find((c) => c.id === draft.categoryId)?.kind ?? 'expense';
  const renderCategories = () => replace(categoryBox, categoryGrid(categories.filter((c) => c.kind === kind), draft.categoryId, (id) => {
    draft.categoryId = draft.categoryId === id ? null : id;
    renderCategories();
  }, { label: 'Categoría' }));
  replace(kindSwitch, segmented([{ value: 'expense', label: 'De gasto' }, { value: 'income', label: 'De ingreso' }], kind, (v) => { kind = v; renderCategories(); }, { label: 'Tipo de categoría' }));
  renderCategories();

  const apply = () => {
    filters = draft;
    sheet.close();
    rerender();
  };
  const sheet = openSheet({
    title: 'Filtros',
    tall: true,
    primary: { label: 'Aplicar', onClick: apply },
    body: [
      field('Tipo', typeChips),
      field('Cuenta', chipPicker(state.accounts, draft.accountId, (id) => { draft.accountId = id; }, { label: 'Cuenta', none: 'Todas' })),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Categoría (toca otra vez para quitarla)'), kindSwitch, categoryBox),
      h('button', { type: 'button', class: 'btn primary', onClick: apply }, 'Aplicar'),
      h('button', { type: 'button', class: 'btn', onClick: () => { filters = { ...NO_FILTERS }; sheet.close(); rerender(); } }, 'Quitar filtros'),
    ],
  });
}

function filterChips(look) {
  const chips = [];
  const add = (label, key) => chips.push(h('button', {
    type: 'button',
    class: 'chip text-only',
    'aria-pressed': 'true',
    'aria-label': `Quitar filtro ${label}`,
    onClick: () => { filters = { ...filters, [key]: null }; rerender(); },
  }, label, icon('x', { size: 16 })));
  if (filters.type) add(TYPE_LABELS[filters.type], 'type');
  if (filters.accountId) add(look.accounts.get(filters.accountId)?.name ?? 'Cuenta', 'accountId');
  if (filters.categoryId) add(look.categories.get(filters.categoryId)?.name ?? 'Categoría', 'categoryId');
  return chips.length ? h('div', { class: 'chips' }, chips) : null;
}

export function movementsView() {
  const state = store.getState();
  const look = lookups(state);
  const container = h('div', { class: 'section' });
  const refresh = () => replace(container, results(state, look));

  const search = h('input', {
    type: 'search', value: query, placeholder: 'Buscar', 'aria-label': 'Buscar movimientos',
    autocomplete: 'off', enterkeyhint: 'search',
  });
  let pending = null;
  search.addEventListener('input', () => {
    query = search.value;
    monthBox.hidden = query.trim() !== '';
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (container.isConnected) refresh();
    }, SEARCH_DELAY_MS);
  });
  const count = activeFilterCount();
  const monthBox = h('div', { hidden: query.trim() !== '' }, monthNav(monthKey, (key) => { monthKey = key; rerender(); }));
  refresh();

  return {
    title: 'Movimientos',
    body: [
      h('div', { class: 'toolbar' },
        h('label', { class: 'search' }, icon('search'), search),
        h('button', { type: 'button', class: 'chip text-only', 'aria-pressed': String(count > 0), onClick: openFilters },
          icon('adjustments-horizontal', { size: 18 }), count ? `Filtros (${count})` : 'Filtros')),
      filterChips(look),
      monthBox,
      container,
    ],
    fab: { label: 'Añadir movimiento', onClick: () => openMovementForm({ preset: { accountId: filters.accountId ?? undefined } }) },
  };
}
