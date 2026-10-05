// Teclado numérico para el PIN (también acepta teclado físico).

import { h } from './dom.js';
import { icon } from './icons.js';
import { PIN_LENGTH } from '../core/vault.js';

export function pinPad({ onComplete }) {
  const length = PIN_LENGTH;
  let digits = '';
  let busy = false;
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' }, Array.from({ length }, () => h('span')));
  const message = h('p', { class: 'pin-msg', role: 'status', 'aria-live': 'polite' });
  const progressText = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  const update = () => {
    [...dots.children].forEach((dot, i) => dot.classList.toggle('on', i < digits.length));
    progressText.textContent = digits.length ? `${digits.length} de ${length} dígitos` : '';
  };
  const setBusy = (value) => {
    busy = value;
    pad.setAttribute('aria-disabled', String(value));
  };
  const press = (digit) => {
    if (busy || digits.length >= length) return;
    digits += digit;
    update();
    if (digits.length === length) {
      const pin = digits;
      setBusy(true); // nada más hasta que se compruebe este PIN (ni teclas ni otro intento)
      setTimeout(() => onComplete(pin), 90); // deja ver el último punto
    }
  };
  const erase = () => {
    if (busy) return;
    digits = digits.slice(0, -1);
    update();
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'del'];
  const pad = h('div', { class: 'pin-pad', role: 'group', 'aria-label': 'Teclado numérico' }, keys.map((key) => {
    if (key === null) return h('span');
    if (key === 'del') return h('button', { type: 'button', class: 'pin-key ghost', 'aria-label': 'Borrar dígito', onClick: erase }, icon('backspace'));
    return h('button', { type: 'button', class: 'pin-key', onClick: () => press(key) }, key);
  }));
  const el = h('div', { class: 'pin' }, dots, message, pad, progressText);

  const onKey = (event) => {
    if (!el.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (document.querySelector('dialog[open]') && !el.closest('dialog[open]')) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      erase();
    }
  };
  document.addEventListener('keydown', onKey);

  return {
    el,
    reset() {
      digits = '';
      update();
      setBusy(false);
    },
    error(text) {
      message.textContent = text;
      message.classList.add('error');
      dots.classList.remove('shake');
      void dots.offsetWidth; // reinicia la animación
      dots.classList.add('shake');
      digits = '';
      update();
      setBusy(false);
    },
    info(text) {
      message.textContent = text;
      message.classList.remove('error');
    },
    setBusy,
  };
}
