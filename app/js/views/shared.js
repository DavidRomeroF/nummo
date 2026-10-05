// Piezas compartidas entre vistas: filas de movimiento, de cuenta y de deuda.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { row, tile, progress } from '../ui/components.js';
import { describeMovement, dueText } from '../ui/format.js';
import { formatMoney } from '../core/money.js';
import { accountTypeInfo, COLOR_KEYS } from '../core/catalog.js';
import { openMovementForm } from './movement-form.js';

/** Más reciente primero (fecha y, dentro del mismo día, hora de creación). */
export const compareNewest = (a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1);

export function movementRow(movement, look, { onClick = () => openMovementForm({ movement }) } = {}) {
  const info = describeMovement(movement, look);
  return row({
    lead: tile({ icon: info.icon, color: info.tone }),
    title: info.title,
    subtitle: info.subtitle,
    value: info.amount,
    valueClass: info.amountClass,
    onClick,
  });
}

export function accountRow(account, balance, { onClick = null, chevron = false } = {}) {
  const details = [accountTypeInfo(account.type).label];
  if (!account.includeInTotal) details.push('no suma al total');
  if (account.archived) details.push('archivada');
  return row({
    lead: tile(account),
    title: account.name,
    subtitle: details.join(' · '),
    value: formatMoney(balance),
    valueClass: balance < 0 ? 'neg' : '',
    onClick,
    chevron,
  });
}

/** Iniciales y color estables para identificar a cada persona o entidad de una deuda. */
export function debtBadge(debt) {
  const words = debt.name.split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : Array.from(words[0] ?? '?').slice(0, 2).join('')).toUpperCase();
  let hash = 0;
  for (const ch of debt.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { letters, color: COLOR_KEYS[hash % COLOR_KEYS.length] };
}

export function debtRow(debt, totals, { onClick }) {
  const due = totals.pending > 0 ? dueText(debt.dueDate) : null;
  const paidRatio = totals.added > 0 ? totals.paid / totals.added : 0;
  const settled = totals.pending <= 0;
  const subtitle = settled ? 'Saldada' : due?.text ?? (debt.note || `${Math.round(paidRatio * 100)} % ${debt.kind === 'owe' ? 'pagado' : 'cobrado'}`);
  return h('button', { type: 'button', class: 'row', onClick },
    tile(debtBadge(debt)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, debt.name),
      h('span', { class: ['row-sub', due?.level === 'danger' && 'neg', due?.level === 'warn' && 'warn'] }, subtitle),
      settled ? null : progress(paidRatio, '', 'Parte pagada')),
    h('span', { class: 'row-value' }, formatMoney(Math.max(totals.pending, 0)), h('small', null, `de ${formatMoney(totals.added)}`)));
}

/** Botones subir/bajar para ordenar una lista (accesibles, sin arrastrar). */
export function moveButtons(items, index, reorder) {
  const move = (delta) => {
    const ids = items.map((x) => x.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    reorder(ids);
  };
  return h('span', { class: 'toolbar' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Subir', disabled: index === 0, onClick: () => move(-1) }, icon('arrow-up')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Bajar', disabled: index === items.length - 1, onClick: () => move(1) }, icon('arrow-down')));
}
