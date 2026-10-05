// Hojas inferiores y alertas sobre <dialog> nativo: foco atrapado, tecla Esc y botón/gesto
// «atrás» de Android (Chrome cierra los diálogos modales con él) sin manipular el historial.

import { h, uid } from './dom.js';

const openSheets = new Set();
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function closeWithAnimation(dialog, done) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.close();
    dialog.remove();
    done?.();
  };
  if (reducedMotion()) return finish();
  dialog.classList.add('closing');
  dialog.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 320); // por si el navegador no emite animationend
}

/**
 * Abre una hoja inferior.
 * { title, body, primary: { label, onClick }, tall, onClose, focus: elemento a enfocar }
 * Devuelve { close, body, dialog, setBusy }.
 */
export function openSheet({ title, body, primary = null, tall = false, onClose = null, focus = null }) {
  const titleId = uid('t');
  const primaryButton = primary
    ? h('button', { type: 'button', class: 'btn-text strong', onClick: () => primary.onClick() }, primary.label)
    : h('span', { 'aria-hidden': 'true' });
  const content = h('div', { class: 'sheet-body' }, body);
  const dialog = h('dialog', { class: ['sheet', tall && 'tall'], 'aria-labelledby': titleId },
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'btn-text', onClick: () => api.close() }, 'Cancelar'),
      h('h2', { class: 'sheet-title', id: titleId }, title),
      primaryButton),
    content);
  let closed = false;
  const api = {
    dialog,
    body: content,
    close() {
      if (closed) return;
      closed = true;
      openSheets.delete(api);
      closeWithAnimation(dialog, onClose);
    },
    setBusy(busy) {
      primaryButton.setAttribute('aria-busy', busy ? 'true' : 'false');
    },
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    api.close();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) api.close(); // toque en el fondo oscurecido
  });
  document.body.append(dialog);
  dialog.showModal();
  focus?.focus(); // en iOS abre el teclado si se llama dentro del mismo toque del usuario
  openSheets.add(api);
  return api;
}

export function closeAllSheets() {
  for (const sheet of [...openSheets]) sheet.close();
}

/** Alerta centrada. actions: [{ label, value, kind: 'strong' | 'danger' }]. Resuelve con `value`. */
function alertDialog({ title, text, actions, input = null, validate = null }) {
  return new Promise((resolve) => {
    const titleId = uid('a');
    const textId = uid('a');
    const error = h('p', { class: 'error', role: 'alert' });
    const dialog = h('dialog', { class: 'alert', role: 'alertdialog', 'aria-labelledby': titleId, 'aria-describedby': textId });
    const finish = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const buttons = actions.map((action) => h('button', {
      type: 'button',
      class: action.kind,
      onClick: () => {
        if (action.value && validate) {
          const message = validate(input?.value ?? '');
          if (message) {
            error.textContent = message;
            return;
          }
        }
        finish(action.value);
      },
    }, action.label));
    dialog.append(
      h('div', { class: 'alert-body' },
        h('h2', { class: 'alert-title', id: titleId }, title),
        text ? h('p', { class: 'alert-text', id: textId }, text) : null,
        input,
        error),
      h('div', { class: 'alert-actions' }, buttons),
    );
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(actions.find((a) => !a.value)?.value ?? false);
    });
    document.body.append(dialog);
    dialog.showModal();
    (input ?? buttons.at(-1)).focus();
  });
}

/** Confirmación. Con `requireText` hay que escribir esa palabra para confirmar (acciones graves). */
export function confirmDialog({ title, text = '', confirmLabel = 'Aceptar', danger = false, requireText = null }) {
  const input = requireText
    ? h('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': `Escribe ${requireText}` })
    : null;
  return alertDialog({
    title,
    text,
    input,
    validate: requireText ? (value) => (value.trim().toUpperCase() === requireText ? '' : `Escribe ${requireText} para confirmar.`) : null,
    actions: [
      { label: 'Cancelar', value: false },
      { label: confirmLabel, value: true, kind: danger ? 'danger' : 'strong' },
    ],
  });
}

export function infoDialog({ title, text, label = 'Entendido' }) {
  return alertDialog({ title, text, actions: [{ label, value: true, kind: 'strong' }] });
}
