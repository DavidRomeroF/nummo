// Avisos breves en la parte inferior, opcionalmente con una acción ("Deshacer").
// Si el navegador soporta popover, se muestran en la capa superior (por encima de las hojas abiertas).

import { h } from './dom.js';

let container = null;
const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

function ensureContainer() {
  if (!container) {
    container = h('div', { class: 'toasts', 'aria-live': 'polite' });
    if (supportsPopover) container.setAttribute('popover', 'manual');
    document.body.append(container);
  }
  return container;
}

function bringToFront(el) {
  if (!supportsPopover) return;
  if (el.matches(':popover-open')) el.hidePopover();
  el.showPopover();
}

/** toast('Movimiento borrado', { action: { label: 'Deshacer', onClick }, kind: 'error' }) */
export function toast(message, { action = null, duration = 4000, kind = '' } = {}) {
  const box = ensureContainer();
  let timer = null;
  let remaining = action ? Math.max(duration, 8000) : duration; // con acción, tiempo para pulsarla
  let startedAt = 0;
  const holds = new Set(); // 'focus' | 'pointer': mientras haya alguno, el aviso no caduca
  const dismiss = () => {
    clearTimeout(timer);
    holds.add('gone'); // ya no se vuelve a programar
    item.remove();
    if (supportsPopover && box.childElementCount === 0 && box.matches(':popover-open')) box.hidePopover();
  };
  const run = () => {
    startedAt = performance.now();
    timer = setTimeout(dismiss, remaining);
  };
  const hold = (reason) => {
    if (holds.size === 0) {
      clearTimeout(timer);
      remaining = Math.max(remaining - (performance.now() - startedAt), 2000);
    }
    holds.add(reason);
  };
  const release = (reason) => {
    if (holds.delete(reason) && holds.size === 0) run();
  };
  const item = h('div', {
    class: ['toast', kind],
    role: kind === 'error' ? 'alert' : 'status',
    onFocusin: () => hold('focus'),
    onFocusout: () => release('focus'),
    onPointerenter: () => hold('pointer'),
    onPointerleave: () => release('pointer'),
  },
  h('span', null, message),
  action ? h('button', { type: 'button', onClick: () => { dismiss(); action.onClick(); } }, action.label) : null);
  box.append(item);
  bringToFront(box);
  run();
  return dismiss;
}

export function clearToasts() {
  if (!container) return;
  container.replaceChildren();
  if (supportsPopover && container.matches(':popover-open')) container.hidePopover();
}
