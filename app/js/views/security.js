// Seguridad: cambiar el PIN, bloqueo automático y explicación de cómo se protegen los datos.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, row } from '../ui/components.js';
import { openSheet } from '../ui/sheet.js';
import { pinPad } from '../ui/pinpad.js';
import { toast } from '../ui/toast.js';
import { lockNow } from '../ui/session.js';
import * as store from '../core/store.js';
import * as vault from '../core/vault.js';
import { AUTO_LOCK_OPTIONS } from '../core/catalog.js';

function openChangePin() {
  let step = 'current';
  let current = null;
  let fresh = null;
  const title = h('p', { class: 'alert-title' }, 'Escribe tu PIN actual');
  const pad = pinPad({
    onComplete: async (pin) => {
      if (step === 'current') {
        pad.setBusy(true);
        try {
          await vault.verifyPin(pin);
          current = pin;
          step = 'new';
          title.textContent = 'Elige el nuevo PIN';
          pad.info('');
        } catch (error) {
          if (error instanceof vault.LockedOutError || error?.lockedUntil) pad.error('Demasiados intentos. Espera unos minutos.');
          else if (error instanceof vault.WrongPinError) pad.error('PIN incorrecto.');
          else throw error;
        } finally {
          pad.setBusy(false);
          pad.reset();
        }
        return;
      }
      if (step === 'new') {
        if (pin === current) return pad.error('El nuevo PIN debe ser distinto del actual.');
        if (vault.isWeakPin(pin)) return pad.error('Ese PIN es muy fácil de adivinar. Elige otro.');
        fresh = pin;
        step = 'confirm';
        title.textContent = 'Repite el nuevo PIN';
        pad.info('');
        return pad.reset();
      }
      if (pin !== fresh) {
        step = 'new';
        title.textContent = 'Elige el nuevo PIN';
        return pad.error('No coinciden. Vuelve a elegir el nuevo PIN.');
      }
      pad.setBusy(true);
      pad.info('Guardando…');
      try {
        await vault.changePin(current, fresh);
        sheet.close();
        toast('PIN cambiado');
      } catch (error) {
        console.error(error);
        pad.setBusy(false);
        pad.error('No se ha podido cambiar el PIN.');
      }
    },
  });
  const sheet = openSheet({ title: 'Cambiar PIN', tall: true, body: [title, pad.el] });
}

export function securityView() {
  const state = store.getState();
  return {
    title: 'Seguridad',
    back: { label: 'Más', path: '/mas' },
    body: [
      section({ title: 'PIN' }, list([
        row({ lead: icon('key'), title: 'Cambiar PIN', chevron: true, onClick: openChangePin }),
        row({ lead: icon('lock'), title: 'Bloquear ahora', onClick: () => lockNow() }),
      ])),
      section({ title: 'Bloqueo automático', caption: 'Cuánto tiempo puede estar la app en segundo plano antes de volver a pedir el PIN.' },
        list(AUTO_LOCK_OPTIONS.map((option) => {
          const selected = option.seconds === state.settings.autoLockSec;
          return row({
            title: option.label,
            trailing: selected ? icon('check', { className: 'icon check' }) : null,
            label: `${option.label}${selected ? ', seleccionado' : ''}`,
            onClick: () => store.updateSettings({ autoLockSec: option.seconds }),
          });
        }), { plain: true })),
      section({ title: 'Cómo se protegen tus datos' },
        h('div', { class: 'card' },
          h('ul', { class: 'benefits' },
            h('li', null, icon('lock'), h('div', null, h('strong', null, 'Cifrado AES-256'), h('span', null, 'Todo se guarda cifrado en este dispositivo. Sin el PIN no se puede leer.'))),
            h('li', null, icon('shield-lock'), h('div', null, h('strong', null, 'Intentos limitados'), h('span', null, 'Tras 5 PIN incorrectos hay que esperar, cada vez más tiempo.'))),
            h('li', null, icon('eye-off'), h('div', null, h('strong', null, 'Privacidad'), h('span', null, 'Al salir de la app se ocultan tus datos y no se envía nada a internet.')))),
          h('p', { class: 'help' }, 'Un PIN de 6 cifras protege frente a quien coja tu móvil. La protección más fuerte la da el propio bloqueo del iPhone o Android: mantenlo activado.'))),
    ],
  };
}
