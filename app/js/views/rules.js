// Reglas de categorías: «si el concepto o el comercio contiene X → categoría Y (o transferencia a
// la cuenta Z)». Se aplican al importar del banco o de un extracto; las aprendidas salen de las
// correcciones de la persona.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, row, tile, field, textInput, segmented, errorText, emptyState, selectInput, toggleRow } from '../ui/components.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import * as store from '../core/store.js';
import { ValidationError, LIMITS } from '../core/model.js';
import { categorize, sortRules, itemFromMovement } from '../core/import/rules.js';

const FIELD_LABELS = { counterparty: 'Comercio', text: 'Concepto', mcc: 'Código de comercio (MCC)' };
const OP_LABELS = { contains: 'contiene', starts: 'empieza por', equals: 'es exactamente' };

/** Vuelve a aplicar las reglas a lo importado que no eligió la persona. Devuelve cuántos cambian. */
export function reapplyAllRules() {
  const s = store.getState();
  const rules = sortRules(s.rules);
  return store.reapplyRules((m) => categorize(itemFromMovement(m), { accountId: m.accountId, categories: s.categories, accounts: s.accounts, rules }));
}

function targetLabel(rule, state) {
  if (rule.toAccountId) return `Transferencia a ${state.accounts.find((a) => a.id === rule.toAccountId)?.name ?? '—'}`;
  return state.categories.find((c) => c.id === rule.categoryId)?.name ?? '—';
}

export function openRuleForm({ rule = null, preset = {} } = {}) {
  const state = store.getState();
  const draft = {
    field: rule?.field ?? preset.field ?? 'counterparty',
    op: rule?.op ?? preset.op ?? 'contains',
    target: rule?.toAccountId ? `acc:${rule.toAccountId}` : rule?.categoryId ? `cat:${rule.categoryId}` : preset.categoryId ? `cat:${preset.categoryId}` : '',
    active: rule?.active ?? true,
  };
  const value = textInput({ value: rule?.value ?? preset.value ?? '', placeholder: 'mercadona', maxLength: LIMITS.ruleValue, capitalize: 'off' });
  const groups = [
    ...state.categories.filter((c) => !c.archived || c.id === rule?.categoryId).map((c) => ({ value: `cat:${c.id}`, label: `${c.kind === 'expense' ? 'Gasto' : 'Ingreso'} · ${c.name}` })),
    ...state.accounts.filter((a) => !a.archived).map((a) => ({ value: `acc:${a.id}`, label: `Transferencia · ${a.name}` })),
  ];
  const { el: targetEl, select } = selectInput(groups, draft.target, { placeholder: 'Elige…', label: 'Resultado' });
  const error = errorText();

  const save = () => {
    error.textContent = '';
    const [kind, id] = select.value.split(':');
    if (!id) {
      error.textContent = 'Elige la categoría o la cuenta.';
      return;
    }
    const data = { field: draft.field, op: draft.op, value: value.value, active: draft.active, origin: 'user', ...(kind === 'cat' ? { categoryId: id } : { toAccountId: id }) };
    try {
      if (rule) store.updateRule(rule.id, data);
      else store.addRule(data);
      sheet.close();
      const changed = reapplyAllRules();
      toast(changed ? `Regla guardada · ${changed} ${changed === 1 ? 'movimiento actualizado' : 'movimientos actualizados'}` : 'Regla guardada');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: '¿Borrar esta regla?', text: 'Los movimientos ya importados no cambian.', confirmLabel: 'Borrar', danger: true }))) return;
    store.deleteRule(rule.id);
    sheet.close();
    toast('Regla borrada');
  };

  const sheet = openSheet({
    title: rule ? 'Editar regla' : 'Nueva regla',
    tall: true,
    primary: { label: 'Guardar', onClick: save },
    focus: rule ? null : value,
    body: [
      field('Si el', segmented(Object.entries(FIELD_LABELS).slice(0, 2).map(([v, label]) => ({ value: v, label })), draft.field, (v) => { draft.field = v; }, { label: 'Campo' })),
      field('Condición', segmented(Object.entries(OP_LABELS).map(([v, label]) => ({ value: v, label })), draft.op, (v) => { draft.op = v; }, { label: 'Condición' })),
      field('Texto', value, { help: 'Sin distinguir mayúsculas ni tildes. Ejemplo: «mercadona», «netflix», «cajero».' }),
      field('Entonces', targetEl, { input: select, help: 'Una categoría de gasto se aplica a cargos y una de ingreso a abonos. «Transferencia» sirve, por ejemplo, para el cajero → Efectivo.' }),
      rule ? list([toggleRow('Activa', draft.active, (checked) => { draft.active = checked; })], { plain: true }) : null,
      error,
      h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
      rule ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar regla') : null,
    ],
  });
}

export function rulesView() {
  const state = store.getState();
  const rules = sortRules(state.rules);
  const categories = new Map(state.categories.map((c) => [c.id, c]));
  const rowFor = (r) => {
    const category = categories.get(r.categoryId);
    return row({
      lead: tile(category ?? { icon: 'arrows-exchange', color: 'graphite' }),
      title: `«${r.value}» → ${targetLabel(r, state)}`,
      subtitle: [`${FIELD_LABELS[r.field]} ${OP_LABELS[r.op]}`, r.origin === 'learned' ? 'aprendida' : null, r.active ? null : 'desactivada'].filter(Boolean).join(' · '),
      chevron: true,
      onClick: () => openRuleForm({ rule: r }),
    });
  };
  return {
    title: 'Reglas',
    back: { label: 'Bancos', path: '/mas/bancos' },
    body: [
      section({ caption: 'Se aplican a los movimientos que llegan del banco o de un extracto, por orden: las tuyas primero y las más concretas antes. Además, Nummo reconoce comercios habituales (Mercadona, Repsol, Netflix…). Cuando cambias la categoría de un movimiento importado, te propone crear una regla.' },
        rules.length ? list(rules.map(rowFor)) : h('div', { class: 'card' }, emptyState('tag', 'Sin reglas todavía', 'Crea la primera o corrige la categoría de un movimiento importado.'))),
      h('button', { type: 'button', class: 'btn', onClick: () => openRuleForm() }, icon('plus'), 'Nueva regla'),
      rules.length ? h('button', {
        type: 'button',
        class: 'btn',
        onClick: () => {
          const changed = reapplyAllRules();
          toast(changed ? `${changed} ${changed === 1 ? 'movimiento actualizado' : 'movimientos actualizados'}` : 'Todo estaba ya al día');
        },
      }, icon('refresh'), 'Volver a aplicar a lo importado') : null,
    ],
  };
}
