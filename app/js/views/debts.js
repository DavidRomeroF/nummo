// Deudas: «Debo» y «Me deben», con detalle de cada una (progreso, pagos y aumentos).

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, row, tile, segmented, progress, emptyState } from '../ui/components.js';
import { lookups, dueText, shortDate, DEBT_FLOW_LABELS } from '../ui/format.js';
import { rerender } from '../ui/shell.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import { formatMoney, formatSigned } from '../core/money.js';
import { debtAccountSign } from '../core/finance.js';
import { openDebtForm, openDebtMovementForm } from './debt-forms.js';
import { debtRow, debtBadge, compareNewest } from './shared.js';

let tab = 'owe';

function byUrgency(a, b) {
  const da = a.debt.dueDate ?? '9999-12-31';
  const db = b.debt.dueDate ?? '9999-12-31';
  return da === db ? b.totals.pending - a.totals.pending : da < db ? -1 : 1;
}

export function debtsView() {
  const state = store.getState();
  const totals = store.derived().summary.debtTotals;
  const items = state.debts.filter((d) => d.kind === tab).map((debt) => ({ debt, totals: totals.get(debt.id) }));
  const pending = items.filter((x) => x.totals.pending > 0).sort(byUrgency);
  const settled = items.filter((x) => x.totals.pending <= 0).sort((a, b) => ((a.totals.lastDate ?? '') < (b.totals.lastDate ?? '') ? 1 : -1));
  const total = pending.reduce((sum, x) => sum + x.totals.pending, 0);
  const open = (debt) => () => router.navigate(`/deudas/${debt.id}`);
  const owe = tab === 'owe';

  return {
    title: 'Deudas',
    actions: [h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Nueva deuda', onClick: () => openDebtForm({ kind: tab }) }, icon('plus'))],
    body: [
      segmented([{ value: 'owe', label: 'Debo' }, { value: 'owed', label: 'Me deben' }], tab, (value) => { tab = value; rerender(); }, { label: 'Tipo de deuda' }),
      h('section', { class: 'card' },
        h('p', { class: 'hero-label' }, owe ? 'Total que debes' : 'Total que te deben'),
        h('p', { class: 'hero-value' }, formatMoney(total)),
        h('p', { class: 'muted' }, pending.length === 1 ? '1 deuda pendiente' : `${pending.length} deudas pendientes`)),
      pending.length
        ? section({ title: 'Pendientes' }, list(pending.map(({ debt, totals: t }) => debtRow(debt, t, { onClick: open(debt) }))))
        : h('div', { class: 'card' }, emptyState('circle-check', owe ? 'No debes nada' : 'Nadie te debe nada',
          owe ? 'Apunta aquí préstamos, compras a plazos o dinero que te hayan dejado.' : 'Apunta aquí el dinero que prestas para no olvidarlo.',
          { label: 'Nueva deuda', onClick: () => openDebtForm({ kind: tab }) })),
      settled.length ? section({ title: 'Saldadas' }, list(settled.map(({ debt, totals: t }) => debtRow(debt, t, { onClick: open(debt) })))) : null,
    ],
  };
}

export function debtDetailView({ id }) {
  const state = store.getState();
  const debt = state.debts.find((d) => d.id === id);
  if (!debt) return null;
  const t = store.derived().summary.debtTotals.get(id);
  const look = lookups(state);
  const owe = debt.kind === 'owe';
  const ratio = t.added > 0 ? t.paid / t.added : 0;
  const due = t.pending > 0 ? dueText(debt.dueDate) : null;
  const history = state.movements.filter((m) => m.type === 'debt' && m.debtId === id).sort(compareNewest);

  const historyRows = history.map((m) => {
    const account = look.accounts.get(m.accountId);
    const sign = debtAccountSign(debt.kind, m.flow);
    return row({
      lead: tile({ icon: m.flow === 'pay' ? 'circle-check' : 'plus', color: m.flow === 'pay' ? 'green' : 'amber' }),
      title: DEBT_FLOW_LABELS[`${debt.kind}:${m.flow}`],
      subtitle: [shortDate(m.date), account?.name ?? 'Sin cuenta', m.note].filter(Boolean).join(' · '),
      value: m.accountId ? formatSigned(sign * m.amount) : formatMoney(m.amount),
      valueClass: m.accountId && sign > 0 ? 'pos' : m.accountId ? '' : 'neutral',
      onClick: () => openDebtMovementForm({ debt, movement: m }),
    });
  });

  return {
    title: debt.name,
    back: { label: 'Deudas', path: '/deudas' },
    actions: [h('button', { type: 'button', class: 'btn-text', onClick: () => openDebtForm({ debt }) }, 'Editar')],
    body: [
      h('section', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', null,
            h('p', { class: 'hero-label' }, t.pending > 0 ? (owe ? 'Te queda por pagar' : 'Te queda por cobrar') : 'Saldada'),
            h('p', { class: 'hero-value' }, formatMoney(Math.max(t.pending, 0)))),
          tile(debtBadge(debt), 'lg')),
        progress(ratio, 'ok', owe ? 'Parte pagada' : 'Parte cobrada'),
        h('div', { class: 'budget-meta' },
          h('span', null, `${owe ? 'Pagado' : 'Cobrado'}: ${formatMoney(t.paid)}`),
          h('span', null, `Total: ${formatMoney(t.added)}`)),
        t.pending < 0 ? h('p', { class: 'warn' }, `Se ha ${owe ? 'pagado' : 'cobrado'} ${formatMoney(-t.pending)} de más.`) : null,
        due ? h('p', { class: due.level === 'danger' ? 'neg' : due.level === 'warn' ? 'warn' : 'muted' }, due.text) : null,
        debt.note ? h('p', { class: 'muted' }, debt.note) : null),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn primary', onClick: () => openDebtMovementForm({ debt, flow: 'pay' }) }, owe ? 'Registrar pago' : 'Registrar cobro'),
        h('button', { type: 'button', class: 'btn', onClick: () => openDebtMovementForm({ debt, flow: 'add' }) }, owe ? 'Me prestan más' : 'Presto más')),
      section({ title: 'Historial', caption: 'Toca un movimiento para cambiarlo o borrarlo.' },
        historyRows.length ? list(historyRows) : h('div', { class: 'card' }, emptyState('clock', 'Sin movimientos'))),
    ],
  };
}
