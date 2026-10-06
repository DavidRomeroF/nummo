// Inicio: patrimonio, resumen del mes, presupuestos en riesgo, cuentas, próximos programados
// y últimos movimientos, más los avisos importantes (copia de seguridad, instalación, versión).

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, row, tile, notice, emptyState } from '../ui/components.js';
import { lookups, monthLabel, ago, shortDate, frequencyLabel, describeMovement } from '../ui/format.js';
import * as router from '../ui/router.js';
import { pwa, promptInstall, applyUpdate } from '../ui/pwa.js';
import * as store from '../core/store.js';
import { formatMoney, formatSigned } from '../core/money.js';
import { currentMonthKey, todayISO, addDays } from '../core/dates.js';
import { nextDate, isFinished } from '../core/recurring.js';
import { openMovementForm } from './movement-form.js';
import { compareNewest, movementRow, accountRow, budgetItem } from './shared.js';
import { showMovementsFor } from './movements.js';
import { showStatsFor } from './stats.js';
import { connectionSummary, syncWithFeedback } from './banks.js';

const BACKUP_REMINDER_DAYS = 30;

const stat = (label, value, className = '') => h('div', { class: 'stat' },
  h('span', { class: 'stat-label' }, label),
  h('span', { class: ['stat-value', className] }, value));

const kv = (label, value, className = '') => [h('dt', { class: className }, label), h('dd', { class: className }, value)];

function notices(state) {
  const items = [];
  if (pwa.updateReady) {
    items.push(notice({
      iconName: 'refresh',
      title: 'Hay una versión nueva',
      text: 'Actualiza para tener las últimas mejoras. Tendrás que volver a poner el PIN.',
      actions: [{ label: 'Actualizar', primary: true, onClick: () => store.flush().finally(applyUpdate) }],
    }));
  }
  const lastBackup = state.settings.lastBackupAt;
  if (state.movements.length > 0 && (!lastBackup || Date.now() - lastBackup > BACKUP_REMINDER_DAYS * 86_400_000)) {
    items.push(notice({
      iconName: 'alert-triangle',
      kind: 'warn',
      title: 'Haz una copia de seguridad',
      text: lastBackup
        ? `Tu última copia es de ${ago(lastBackup)}.`
        : 'Aún no tienes ninguna. Si borras la app o cambias de móvil, perderías tus datos.',
      actions: [{ label: 'Hacer copia', primary: true, onClick: () => router.navigate('/mas/copias') }],
    }));
  }
  for (const c of state.connections) {
    const summary = connectionSummary(c);
    if (summary.level !== 'danger') continue;
    items.push(notice({
      iconName: 'building-bank',
      kind: 'warn',
      title: c.bankName,
      text: summary.text,
      actions: [{ label: 'Revisar', primary: true, onClick: () => router.navigate('/mas/bancos') }],
    }));
  }
  if (!pwa.isStandalone && !state.settings.installHintDismissed && (pwa.isIOS || pwa.canPromptInstall)) {
    const dismiss = { label: 'Ahora no', onClick: () => store.updateSettings({ installHintDismissed: true }) };
    items.push(pwa.canPromptInstall
      ? notice({ iconName: 'device-mobile', title: 'Instala la app', text: 'Tendrás su icono en la pantalla de inicio y se abrirá a pantalla completa. Tus datos se mantienen.', actions: [{ label: 'Instalar', primary: true, onClick: () => promptInstall() }, dismiss] })
      : notice({ iconName: 'device-mobile', title: 'Úsala como app', text: 'En Safari, pulsa Compartir y «Añadir a pantalla de inicio». La app instalada empieza vacía: antes haz una copia de seguridad aquí y restáurala allí.', actions: [dismiss] }));
  }
  return items;
}

export function homeView() {
  const state = store.getState();
  const derived = store.derived();
  const { balances, totalBalance, totalOwe, totalOwed, netWorth } = derived.summary;
  const monthKey = currentMonthKey();
  const month = derived.month(monthKey);
  const look = lookups(state);
  const today = todayISO();

  const body = [...notices(state)];

  body.push(h('section', { class: 'card', 'aria-label': 'Resumen' },
    h('div', null,
      h('p', { class: 'hero-label' }, 'Patrimonio neto'),
      h('p', { class: ['hero-value', netWorth < 0 && 'neg'] }, formatMoney(netWorth))),
    h('div', { class: 'stats' },
      stat('En cuentas', formatMoney(totalBalance)),
      stat('Debes', formatMoney(totalOwe)),
      stat('Te deben', formatMoney(totalOwed)))));

  body.push(h('button', { type: 'button', class: 'card', onClick: () => showStatsFor(monthKey) },
    h('div', { class: 'card-head' },
      h('span', { class: 'card-title' }, `Este mes · ${monthLabel(monthKey)}`),
      icon('chevron-right', { className: 'icon chev' })),
    h('dl', { class: 'kv' },
      kv('Ingresos', formatSigned(month.income), month.income ? 'pos' : ''),
      kv('Gastos', formatSigned(-month.expense)),
      month.debtNet ? kv('Deudas (pagos y cobros)', formatSigned(month.debtNet)) : null,
      kv('Resultado', formatSigned(month.result), `total ${month.result < 0 ? 'neg' : ''}`))));

  const atRisk = derived.budgets(monthKey).filter((b) => b.level !== 'ok').slice(0, 3);
  if (atRisk.length) {
    body.push(section({ title: 'Presupuestos', action: { label: 'Ver todos', onClick: () => router.navigate('/mas/presupuestos') } },
      list(atRisk.map((b) => budgetItem(b, look.categories.get(b.categoryId))))));
  }

  const accounts = state.accounts.filter((a) => !a.archived);
  const bankLines = state.connections.map((c) => `${c.bankName} · ${connectionSummary(c).text.toLowerCase()}`);
  body.push(section({ title: 'Cuentas', action: { label: 'Gestionar', onClick: () => router.navigate('/mas/cuentas') }, caption: bankLines.join(' · ') || null },
    accounts.length
      ? list(accounts.map((a) => accountRow(a, balances.get(a.id) ?? 0, { chevron: true, onClick: () => showMovementsFor({ accountId: a.id }) })))
      : emptyState('building-bank', 'Sin cuentas', 'Añade tu banco, tarjeta o efectivo.', { label: 'Añadir cuenta', onClick: () => router.navigate('/mas/cuentas') }),
    state.connections.some((c) => c.status === 'active')
      ? h('button', { type: 'button', class: 'btn', onClick: () => state.connections.filter((c) => c.status === 'active').forEach((c) => syncWithFeedback(c.id)) }, icon('refresh'), 'Sincronizar ahora')
      : null));

  const upcoming = state.recurring
    .filter((r) => r.active && !isFinished(r))
    .map((r) => ({ rule: r, date: nextDate(r) }))
    .filter((x) => x.date <= addDays(today, 14))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);
  if (upcoming.length) {
    body.push(section({ title: 'Próximos programados', action: { label: 'Ver', onClick: () => router.navigate('/mas/programados') } },
      list(upcoming.map(({ rule, date }) => {
        const info = describeMovement({ ...rule.template, date }, look);
        return row({
          lead: tile({ icon: info.icon, color: info.tone }),
          title: info.title,
          subtitle: `${shortDate(date)} · ${frequencyLabel(rule.frequency, rule.interval)}`,
          value: info.amount,
          valueClass: info.amountClass,
        });
      }))));
  }

  const recent = [...state.movements].sort(compareNewest).slice(0, 6);
  body.push(section({ title: 'Últimos movimientos', action: recent.length ? { label: 'Ver todos', onClick: () => showMovementsFor({}) } : null },
    recent.length
      ? list(recent.map((m) => movementRow(m, look)))
      : h('div', { class: 'card' }, emptyState('plus', 'Apunta tu primer gasto', 'Pulsa el botón + para añadir gastos, ingresos o transferencias.', { label: 'Añadir', onClick: () => openMovementForm() }))));

  return {
    title: 'Inicio',
    body,
    fab: { label: 'Añadir movimiento', onClick: () => openMovementForm() },
  };
}
