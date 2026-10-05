// Piezas de interfaz reutilizables (listas, filas, selectores, campos, avisos…).

import { h, uid } from './dom.js';
import { icon } from './icons.js';
import { monthLabel } from './format.js';
import { COLOR_KEYS, PICKER_ICONS, ICON_LABELS, COLOR_LABELS } from '../core/catalog.js';
import { parseAmount, centsToInput } from '../core/money.js';
import { addMonthKey, currentMonthKey, isISODate, MIN_YEAR, MAX_YEAR } from '../core/dates.js';

/** Cuadrado de color con símbolo o iniciales. item: { icon, color, letters? } */
export function tile(item, size = '') {
  return h('span', { class: ['tile', size, `tone-${item.color}`], 'aria-hidden': 'true' },
    item.letters ? h('span', { class: 'letters' }, item.letters) : icon(item.icon));
}

export function section({ title = null, action = null, caption = null } = {}, ...children) {
  return h('section', { class: 'section' },
    title || action
      ? h('div', { class: 'section-head' },
        title ? h('h2', { class: 'section-title' }, title) : h('span'),
        action ? h('button', { type: 'button', class: 'section-link', onClick: action.onClick }, action.label) : null)
      : null,
    children,
    caption ? h('p', { class: 'caption' }, caption) : null);
}

export function list(rows, { plain = false } = {}) {
  return h('ul', { class: ['list', plain && 'plain'] }, rows.filter(Boolean).map((r) => h('li', null, r)));
}

/** Fila de lista; es un botón si recibe onClick. */
export function row({
  lead = null, title, subtitle = null, value = null, valueClass = '',
  chevron = false, onClick = null, className = '', trailing = null, label = null,
}) {
  return h(onClick ? 'button' : 'div', { class: ['row', className], type: onClick ? 'button' : null, onClick, 'aria-label': label },
    lead,
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, title),
      subtitle ? h('span', { class: 'row-sub' }, subtitle) : null),
    value !== null ? h('span', { class: ['row-value', valueClass] }, value) : null,
    trailing,
    chevron ? icon('chevron-right', { className: 'icon chev' }) : null);
}

/** Grupo de botones excluyentes. options: [{ value, label }] */
export function segmented(options, value, onChange, { label = '' } = {}) {
  const el = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const option of options) {
    const button = h('button', { type: 'button', 'aria-pressed': String(option.value === value) }, option.label);
    button.addEventListener('click', () => {
      for (const b of el.children) b.setAttribute('aria-pressed', String(b === button));
      onChange(option.value);
    });
    el.append(button);
  }
  return el;
}

/** Etiqueta + control + ayuda. `input` es el elemento enfocable si el control es un envoltorio. */
export function field(labelText, control, { input = null, help = null, error = null } = {}) {
  const target = input ?? (control instanceof HTMLInputElement || control instanceof HTMLSelectElement ? control : null);
  let labelEl;
  if (target) {
    target.id ||= uid('in');
    labelEl = h('label', { class: 'field-label', for: target.id }, labelText);
  } else {
    labelEl = h('span', { class: 'field-label', 'aria-hidden': 'true' }, labelText);
  }
  const helpEl = help ? h('p', { class: 'help', id: uid('h') }, help) : null;
  if (helpEl && target) target.setAttribute('aria-describedby', helpEl.id);
  return h('div', { class: 'field' }, labelEl, control, helpEl, error);
}

export function errorText() {
  return h('p', { class: 'error', role: 'alert' });
}

export function textInput({ value = '', placeholder = '', maxLength = 40, capitalize = 'sentences', label = null } = {}) {
  return h('input', {
    class: 'input', type: 'text', value, placeholder, maxlength: maxLength, autocomplete: 'off',
    autocapitalize: capitalize, enterkeyhint: 'done', 'aria-label': label,
  });
}

export function dateInput(value) {
  return h('input', { class: 'input', type: 'date', value, min: `${MIN_YEAR}-01-01`, max: `${MAX_YEAR}-12-31`, required: true });
}

/** Lee una fecha de un <input type="date">; null si está vacía o no es válida. */
export const readDate = (input) => (isISODate(input.value) ? input.value : null);

/**
 * Campo de importe grande. read() devuelve céntimos o null (y muestra el error).
 * allowNegative/allowZero para saldos; los movimientos exigen importe > 0.
 */
export function amountInput({ value = null, label = 'Importe', allowNegative = false, allowZero = false, compact = false } = {}) {
  const input = h('input', {
    class: compact ? 'input num amount-compact' : null,
    type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done', placeholder: '0,00',
    'aria-label': label, value: value === null ? '' : centsToInput(value),
  });
  const error = errorText();
  input.addEventListener('input', () => {
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  });
  // El teclado decimal de iOS no tiene signo menos: botón para cambiar el signo (saldos negativos).
  const sign = allowNegative
    ? h('button', { type: 'button', class: 'sign-toggle', 'aria-label': 'Cambiar entre positivo y negativo' }, '+/−')
    : null;
  sign?.addEventListener('click', () => {
    const text = input.value.trim();
    input.value = /^[-\u2212]/.test(text) ? text.slice(1) : `-${text}`;
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
  const compactBox = h('div', { class: 'amount-compact-wrap' }, input, h('span', { 'aria-hidden': 'true' }, '€'));
  const el = compact
    ? h('div', { class: 'field' }, sign ? h('div', { class: 'amount-row' }, sign, compactBox) : compactBox, error)
    : h('div', { class: 'field' },
      h('div', { class: 'amount-field' }, input, h('span', { class: 'currency', 'aria-hidden': 'true' }, '€')),
      error);
  return {
    el,
    input,
    read() {
      const cents = parseAmount(input.value, { allowNegative });
      const ok = cents !== null && (cents > 0 || (allowZero && cents === 0) || (allowNegative && cents < 0));
      if (!ok) {
        error.textContent = input.value.trim() ? 'Escribe un importe válido, por ejemplo 12,50.' : 'Escribe un importe.';
        input.setAttribute('aria-invalid', 'true');
        return null;
      }
      return cents;
    },
    set(cents) {
      input.value = centsToInput(cents);
    },
  };
}

/** Fila de chips con una opción seleccionada (cuentas). items: [{ id, name, icon, color, letters }] */
export function chipPicker(items, selected, onSelect, { label, none = null } = {}) {
  const el = h('div', { class: 'chips', role: 'group', 'aria-label': label });
  const add = (id, content, textOnly = false) => {
    const button = h('button', { type: 'button', class: ['chip', textOnly && 'text-only'], 'aria-pressed': String(id === selected) }, content);
    button.addEventListener('click', () => {
      for (const b of el.children) b.setAttribute('aria-pressed', String(b === button));
      onSelect(id);
    });
    el.append(button);
  };
  if (none) add(null, none, true);
  for (const item of items) add(item.id, [tile(item, 'sm'), item.name]);
  requestAnimationFrame(() => el.querySelector('[aria-pressed="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  return el;
}

/** Cuadrícula de categorías. */
export function categoryGrid(categories, selected, onSelect, { label = 'Categoría' } = {}) {
  const el = h('div', { class: 'pick-grid', role: 'group', 'aria-label': label });
  for (const category of categories) {
    const button = h('button', { type: 'button', class: 'pick', 'aria-pressed': String(category.id === selected) },
      tile(category), h('span', null, category.name));
    button.addEventListener('click', () => {
      for (const b of el.children) b.setAttribute('aria-pressed', String(b === button));
      onSelect(category.id);
    });
    el.append(button);
  }
  return el;
}

/** Selector de símbolo; setColor() cambia el color de la selección. */
export function iconPicker(selected, color, onSelect) {
  const el = h('div', { class: ['icon-grid', `tone-${color}`], role: 'group', 'aria-label': 'Símbolo' });
  for (const name of PICKER_ICONS) {
    const button = h('button', { type: 'button', class: 'icon-choice', 'aria-pressed': String(name === selected), 'aria-label': ICON_LABELS[name] ?? name }, icon(name));
    button.addEventListener('click', () => {
      for (const b of el.children) b.setAttribute('aria-pressed', String(b === button));
      onSelect(name);
    });
    el.append(button);
  }
  return {
    el,
    setColor(next) {
      el.setAttribute('class', `icon-grid tone-${next}`);
    },
  };
}

export function colorPicker(selected, onSelect) {
  const el = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Color' });
  for (const key of COLOR_KEYS) {
    const button = h('button', { type: 'button', class: ['swatch', `tone-${key}`], 'aria-pressed': String(key === selected), 'aria-label': COLOR_LABELS[key] });
    button.addEventListener('click', () => {
      for (const b of el.children) b.setAttribute('aria-pressed', String(b === button));
      onSelect(key);
    });
    el.append(button);
  }
  return el;
}

export function toggleRow(labelText, checked, onChange, { help = null } = {}) {
  const input = h('input', { type: 'checkbox', class: 'toggle', role: 'switch', checked, id: uid('sw') });
  input.addEventListener('change', () => onChange(input.checked));
  return h('div', { class: 'switch-row' },
    h('label', { for: input.id, class: 'row-main' },
      h('span', { class: 'row-title' }, labelText),
      help ? h('span', { class: 'row-sub' }, help) : null),
    input);
}

export function progress(ratio, level = '', label = '') {
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * 100;
  return h('div', {
    class: ['progress', level], role: 'progressbar', 'aria-label': label,
    'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(pct),
  }, h('span', { style: { '--p': `${pct}%` } }));
}

export function emptyState(iconName, title, text = null, action = null) {
  return h('div', { class: 'empty' },
    icon(iconName),
    h('strong', null, title),
    text ? h('p', null, text) : null,
    action ? h('button', { type: 'button', class: 'btn small primary', onClick: action.onClick }, action.label) : null);
}

export function monthNav(key, onChange) {
  const current = currentMonthKey();
  return h('div', { class: 'month-nav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes anterior', onClick: () => onChange(addMonthKey(key, -1)) }, icon('chevron-left')),
    h('div', { class: 'label' },
      h('div', { 'aria-live': 'polite' }, monthLabel(key)),
      key !== current ? h('button', { type: 'button', class: 'btn-text today', onClick: () => onChange(current) }, 'Volver al mes actual') : null),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Mes siguiente', onClick: () => onChange(addMonthKey(key, 1)) }, icon('chevron-right')));
}

/** Aviso destacado. actions: [{ label, onClick, primary }] */
export function notice({ iconName = 'info-circle', title = null, text = null, kind = '', actions = [] }) {
  return h('div', { class: ['notice', kind] },
    icon(iconName),
    h('div', { class: 'notice-body' },
      title ? h('p', { class: 'notice-title' }, title) : null,
      text ? h('p', null, text) : null,
      actions.length
        ? h('div', { class: 'notice-actions' }, actions.map((a) => h('button', { type: 'button', class: ['btn', 'small', a.primary && 'primary'], onClick: a.onClick }, a.label)))
        : null));
}

export function stepper(value, { min = 1, max = 12, label, onChange }) {
  let current = value;
  const output = h('output', { 'aria-live': 'polite' }, String(value));
  const set = (next) => {
    current = Math.max(min, Math.min(max, next));
    output.textContent = String(current);
    onChange(current);
  };
  return h('div', { class: 'stepper', role: 'group', 'aria-label': label },
    h('button', { type: 'button', 'aria-label': 'Menos', onClick: () => set(current - 1) }, '−'),
    output,
    h('button', { type: 'button', 'aria-label': 'Más', onClick: () => set(current + 1) }, '+'));
}
