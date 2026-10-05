// Categorías de gasto e ingreso: lista, orden, archivo y hoja de edición.

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  section, list, row, tile, field, textInput, segmented, iconPicker, colorPicker, toggleRow, errorText, categoryGrid,
} from '../ui/components.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { rerender } from '../ui/shell.js';
import { registerViewReset } from '../ui/session.js';
import * as store from '../core/store.js';
import { ValidationError, LIMITS } from '../core/model.js';
import { moveButtons } from './shared.js';

let kind = 'expense';
let sorting = false;
registerViewReset(() => {
  kind = 'expense';
  sorting = false;
});

export function categoriesView() {
  const state = store.getState();
  const ofKind = state.categories.filter((c) => c.kind === kind);
  const active = ofKind.filter((c) => !c.archived);
  const archived = ofKind.filter((c) => c.archived);
  const used = new Map();
  for (const m of state.movements) if (m.categoryId) used.set(m.categoryId, (used.get(m.categoryId) ?? 0) + 1);
  const usage = (c) => {
    const n = used.get(c.id) ?? 0;
    return n === 1 ? '1 movimiento' : `${n} movimientos`;
  };

  return {
    title: 'Categorías',
    back: { label: 'Más', path: '/mas' },
    actions: active.length > 1
      ? [h('button', { type: 'button', class: 'btn-text', onClick: () => { sorting = !sorting; rerender(); } }, sorting ? 'Hecho' : 'Ordenar')]
      : [],
    body: [
      segmented([{ value: 'expense', label: 'De gasto' }, { value: 'income', label: 'De ingreso' }], kind, (value) => { kind = value; rerender(); }, { label: 'Tipo' }),
      section({ caption: sorting ? 'Este orden es el que verás al apuntar un movimiento.' : null },
        list(active.map((c, i) => (sorting
          ? row({ lead: tile(c), title: c.name, trailing: moveButtons(active, i, (ids) => store.reorderCategories(ids)) })
          : row({ lead: tile(c), title: c.name, subtitle: usage(c), chevron: true, onClick: () => openCategoryForm({ category: c }) }))))),
      h('button', { type: 'button', class: 'btn', onClick: () => openCategoryForm({ kind }) }, icon('plus'), 'Nueva categoría'),
      archived.length
        ? section({ title: 'Archivadas', caption: 'No aparecen al apuntar movimientos, pero se conservan en el historial.' },
          list(archived.map((c) => row({ lead: tile(c), title: c.name, subtitle: usage(c), chevron: true, onClick: () => openCategoryForm({ category: c }) }))))
        : null,
    ],
  };
}

/** Pide la categoría a la que pasar los movimientos antes de borrar otra. */
function chooseReplacement(category) {
  return new Promise((resolve) => {
    const options = store.getState().categories.filter((c) => c.kind === category.kind && c.id !== category.id && !c.archived);
    let chosen = null;
    const done = (value) => {
      chosen = value;
      picker.close();
    };
    const picker = openSheet({
      title: 'Mover movimientos a…',
      tall: true,
      onClose: () => resolve(chosen),
      body: [
        h('p', { class: 'help' }, `«${category.name}» tiene movimientos. Elige a qué categoría pasan antes de borrarla.`),
        categoryGrid(options, null, (id) => done(id), { label: 'Categoría de destino' }),
      ],
    });
  });
}

export function openCategoryForm({ category = null, kind: newKind = 'expense' } = {}) {
  const editing = category !== null;
  const draft = { icon: category?.icon ?? 'tag', color: category?.color ?? 'blue', archived: category?.archived ?? false };
  const preview = h('div', { class: 'preview' });
  const refresh = () => replace(preview, tile({ icon: draft.icon, color: draft.color }, 'lg'));
  const name = textInput({ value: category?.name ?? '', placeholder: 'Por ejemplo: Gimnasio', maxLength: LIMITS.name });
  const icons = iconPicker(draft.icon, draft.color, (value) => { draft.icon = value; refresh(); });
  const error = errorText();
  refresh();

  const save = () => {
    error.textContent = '';
    try {
      const data = { name: name.value, icon: draft.icon, color: draft.color, archived: draft.archived };
      if (editing) store.updateCategory(category.id, data);
      else store.addCategory({ ...data, kind: newKind });
      sheet.close();
      toast(editing ? 'Categoría guardada' : 'Categoría creada');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };

  const remove = async () => {
    const usage = store.categoryUsage(category.id);
    let replacementId = null;
    if (usage.movements || usage.recurring) {
      replacementId = await chooseReplacement(category);
      if (!replacementId) return;
    } else {
      const confirmed = await confirmDialog({
        title: `¿Borrar «${category.name}»?`,
        text: usage.budget ? 'También se quitará su presupuesto.' : 'No tiene movimientos.',
        confirmLabel: 'Borrar',
        danger: true,
      });
      if (!confirmed) return;
    }
    try {
      store.deleteCategory(category.id, replacementId);
      sheet.close();
      toast('Categoría borrada');
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    }
  };

  const sheet = openSheet({
    title: editing ? 'Editar categoría' : 'Nueva categoría',
    tall: true,
    primary: { label: 'Guardar', onClick: save },
    focus: editing ? null : name,
    body: [
      preview,
      field('Nombre', name),
      field('Símbolo', icons.el),
      field('Color', colorPicker(draft.color, (value) => { draft.color = value; icons.setColor(value); refresh(); })),
      editing ? list([toggleRow('Archivada', draft.archived, (checked) => { draft.archived = checked; }, { help: 'No aparecerá al apuntar movimientos.' })], { plain: true }) : null,
      error,
      h('button', { type: 'button', class: 'btn primary', onClick: save }, 'Guardar'),
      editing ? h('button', { type: 'button', class: 'btn danger', onClick: remove }, 'Borrar categoría') : null,
    ],
  });
}
