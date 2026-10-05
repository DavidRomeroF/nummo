// Hojas inferiores y alertas sobre <dialog> nativo: foco atrapado, tecla Esc y botón/gesto
// «atrás» de Android (Chrome cierra los diálogos modales con él) sin manipular el historial.

import { h, uid } from './dom.js';
import { focusKey, restoreFocus } from './focus.js';

const openSheets = new Set();
const openAlerts = new Set(); // funciones que cierran una alerta como «Cancelar»
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function closeDialog(dialog, done, immediate, openerKey = null) {
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    dialog.close();
    dialog.remove();
    done?.();
    // Devuelve el foco al botón que abrió la hoja (o a su equivalente si la vista se repintó).
    if (!immediate) {
      requestAnimationFrame(() => {
        if (!restoreFocus(document.getElementById('app'), openerKey)) document.querySelector('main h1')?.focus({ preventScroll: true });
      });
    }
  };
  // Mientras se va, ya no admite toques ni teclas: un doble toque en «Guardar» no guarda dos veces.
  dialog.inert = true;
  if (immediate || reducedMotion()) return finish();
  dialog.classList.add('closing');
  dialog.addEventListener('animationend', finish, { once: true });
  setTimeout(finish, 320); // por si el navegador no emite animationend
}

/**
 * Abre una hoja inferior.
 * { title, body, primary: { label, onClick }, tall, onClose, focus: elemento a enfocar }
 * Devuelve { close }.
 */
export function openSheet({ title, body, primary = null, tall = false, onClose = null, focus = null }) {
  const titleId = uid('t');
  const openerKey = focusKey(document.activeElement);
  const primaryButton = primary
    ? h('button', { type: 'button', class: 'btn-text strong', onClick: () => primary.onClick() }, primary.label)
    : h('span', { 'aria-hidden': 'true' });
  const dialog = h('dialog', { class: ['sheet', tall && 'tall'], 'aria-labelledby': titleId },
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'btn-text', onClick: () => api.close() }, 'Cancelar'),
      h('h2', { class: 'sheet-title', id: titleId }, title),
      primaryButton),
    h('div', { class: 'sheet-body' }, body));
  let closed = false;
  const api = {
    /** immediate: sin animación (al bloquear, para que nada quede a la vista). */
    close(immediate = false) {
      if (closed) return;
      closed = true;
      openSheets.delete(api);
      closeDialog(dialog, onClose, immediate, openerKey);
    },
  };
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    api.close();
  });
  // Una vez pedido el cierre, ningún clic llega ya a los botones (ni un segundo «Guardar»).
  dialog.addEventListener('click', (event) => {
    if (!closed) return;
    event.stopImmediatePropagation();
    event.preventDefault();
  }, true);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) api.close(); // toque en el fondo oscurecido
  });
  document.body.append(dialog);
  dialog.showModal();
  focus?.focus(); // en iOS abre el teclado si se llama dentro del mismo toque del usuario
  openSheets.add(api);
  return api;
}

/** Cierra todas las hojas y alertas (las alertas, como si se pulsara «Cancelar»). */
export function closeAllSheets({ immediate = false } = {}) {
  for (const sheet of [...openSheets]) sheet.close(immediate);
  for (const dismiss of [...openAlerts]) dismiss();
}

/** Alerta centrada. actions: [{ label, value, kind: 'strong' | 'danger' }]. Resuelve con `value`. */
function alertDialog({ title, text, actions, input = null, validate = null }) {
  return new Promise((resolve) => {
    const titleId = uid('a');
    const textId = uid('a');
    const error = h('p', { class: 'error', role: 'alert' });
    const dialog = h('dialog', { class: 'alert', role: 'alertdialog', 'aria-labelledby': titleId, 'aria-describedby': textId });
    const cancelValue = actions.find((a) => !a.value)?.value ?? false;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      openAlerts.delete(dismiss);
      dialog.inert = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const dismiss = () => finish(cancelValue);
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
      dismiss();
    });
    document.body.append(dialog);
    dialog.showModal();
    openAlerts.add(dismiss);
    // El foco empieza en «Cancelar»: Intro o Espacio nunca confirman por error una acción grave.
    (input ?? buttons[0]).focus();
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
