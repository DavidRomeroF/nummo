// Seguridad: cambiar el PIN, bloqueo automático y explicación de cómo se protegen los datos.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, row, field, errorText, notice } from '../ui/components.js';
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
  const title = h('p', { class: 'alert-title', 'aria-live': 'polite' }, 'Escribe tu PIN actual');
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

/** Campo de contraseña para formularios. */
const passwordInput = (placeholder, autocomplete = 'new-password') => h('input', {
  class: 'input', type: 'password', autocomplete, placeholder, autocapitalize: 'off', spellcheck: 'false',
});

/**
 * Pasar a contraseña (o cambiarla). Primero se comprueba el secreto actual (PIN o contraseña);
 * después se elige la nueva. Solo se vuelve a cifrar la clave maestra: los datos no cambian.
 */
function openSetPassword() {
  const fromPin = vault.currentSecretKind() === 'pin';
  const error = errorText();
  const current = passwordInput('Contraseña actual', 'current-password');
  const fresh = passwordInput(`Mínimo ${vault.MIN_PASSWORD_LENGTH} caracteres`);
  const repeat = passwordInput('Repítela');
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Guardar contraseña');
  const box = h('div', { class: 'form' });
  let currentSecret = null;

  const showNew = () => {
    box.replaceChildren(
      notice({ iconName: 'info-circle', text: 'Usa una frase fácil de recordar para ti y difícil de adivinar, por ejemplo cuatro palabras al azar. Si la olvidas, solo podrás recuperar tus datos con una copia de seguridad.' }),
      field('Nueva contraseña', fresh), field('Repite la contraseña', repeat), error, save);
    fresh.focus();
  };
  save.addEventListener('click', async () => {
    error.textContent = '';
    const problem = vault.passwordProblem(fresh.value);
    if (problem) {
      error.textContent = problem;
      return;
    }
    if (fresh.value !== repeat.value) {
      error.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    save.setAttribute('aria-busy', 'true');
    try {
      await vault.changeSecret(currentSecret ?? current.value, fresh.value, 'password');
      fresh.value = '';
      repeat.value = '';
      sheet.close();
      toast('Ahora Nummo se abre con tu contraseña');
    } catch (e) {
      console.error(e?.name);
      error.textContent = e instanceof vault.WrongPinError ? 'La contraseña actual no es correcta.' : 'No se ha podido guardar la contraseña.';
    } finally {
      save.removeAttribute('aria-busy');
    }
  });

  if (fromPin) {
    const title = h('p', { class: 'alert-title', 'aria-live': 'polite' }, 'Escribe tu PIN actual');
    const pad = pinPad({
      onComplete: async (pin) => {
        try {
          await vault.verifyPin(pin);
          currentSecret = pin;
          showNew();
        } catch (e) {
          if (e instanceof vault.LockedOutError || e?.lockedUntil) pad.error('Demasiados intentos. Espera unos minutos.');
          else if (e instanceof vault.WrongPinError) pad.error('PIN incorrecto.');
          else throw e;
        }
      },
    });
    box.append(title, pad.el);
  } else {
    box.append(field('Contraseña actual', current), field('Nueva contraseña', fresh), field('Repite la contraseña', repeat), error, save);
  }
  const sheet = openSheet({ title: fromPin ? 'Usar contraseña' : 'Cambiar contraseña', tall: true, body: [box], focus: fromPin ? null : current });
}

/** Volver al PIN (solo si no hay ningún banco conectado: su acceso exige contraseña). */
function openBackToPin() {
  if (store.getSecrets()) {
    toast('Primero desconecta el banco: su acceso solo se guarda con contraseña.', { kind: 'error' });
    return;
  }
  const error = errorText();
  const current = passwordInput('Contraseña actual', 'current-password');
  const check = h('button', { type: 'button', class: 'btn primary' }, 'Continuar');
  const box = h('div', { class: 'form' }, field('Contraseña actual', current), error, check);
  check.addEventListener('click', async () => {
    error.textContent = '';
    try {
      await vault.verifyPin(current.value);
    } catch (e) {
      error.textContent = e instanceof vault.WrongPinError ? 'Contraseña incorrecta.' : 'Demasiados intentos. Espera unos minutos.';
      return;
    }
    const secret = current.value;
    current.value = '';
    let first = null;
    const title = h('p', { class: 'alert-title', 'aria-live': 'polite' }, 'Elige el nuevo PIN');
    const pad = pinPad({
      onComplete: async (pin) => {
        if (!first) {
          if (vault.isWeakPin(pin)) return pad.error('Ese PIN es muy fácil de adivinar. Elige otro.');
          first = pin;
          title.textContent = 'Repite el nuevo PIN';
          pad.info('');
          return pad.reset();
        }
        if (pin !== first) {
          first = null;
          title.textContent = 'Elige el nuevo PIN';
          return pad.error('No coinciden. Vuelve a empezar.');
        }
        try {
          await vault.changeSecret(secret, pin, 'pin');
          sheet.close();
          toast('Ahora Nummo se abre con tu PIN');
        } catch (e) {
          pad.error(e?.message?.startsWith('Desconecta') ? e.message : 'No se ha podido cambiar.');
        }
      },
    });
    box.replaceChildren(title, pad.el);
  });
  const sheet = openSheet({ title: 'Volver a usar PIN', tall: true, body: [box], focus: current });
}

export function securityView() {
  const state = store.getState();
  const usesPassword = vault.currentSecretKind() === 'password';
  return {
    title: 'Seguridad',
    back: { label: 'Más', path: '/mas' },
    body: [
      section({
        title: usesPassword ? 'Contraseña' : 'PIN',
        caption: usesPassword
          ? 'Nummo se abre con una contraseña. Es lo que protege el acceso a tu banco.'
          : 'Para conectar un banco, Nummo pide usar una contraseña en lugar del PIN: un PIN de 6 cifras se puede adivinar probando si alguien copia los datos del dispositivo.',
      }, list([
        usesPassword
          ? row({ lead: icon('key'), title: 'Cambiar contraseña', chevron: true, onClick: openSetPassword })
          : row({ lead: icon('key'), title: 'Cambiar PIN', chevron: true, onClick: openChangePin }),
        usesPassword
          ? row({ lead: icon('lock-open'), title: 'Volver a usar PIN', chevron: true, onClick: openBackToPin })
          : row({ lead: icon('shield-lock'), title: 'Usar contraseña en vez de PIN', chevron: true, onClick: openSetPassword }),
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
            h('li', null, icon('shield-lock'), h('div', null, h('strong', null, 'Intentos limitados'), h('span', null, `Tras ${vault.FREE_ATTEMPTS} PIN incorrectos hay que esperar, cada vez más tiempo.`))),
            h('li', null, icon('eye-off'), h('div', null, h('strong', null, 'Privacidad'), h('span', null, 'Al salir de la app se ocultan tus datos y no se envía nada a internet.')))),
          h('p', { class: 'help' }, usesPassword
            ? 'Con una contraseña larga, tus datos siguen protegidos aunque alguien copie el almacenamiento del dispositivo. Mantén también activado el bloqueo del móvil.'
            : 'Un PIN de 6 cifras protege frente a quien coja tu móvil. La protección más fuerte la da el propio bloqueo del iPhone o Android: mantenlo activado.'))),
    ],
  };
}
