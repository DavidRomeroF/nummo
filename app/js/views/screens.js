// Pantallas fuera de la app desbloqueada: bienvenida, crear PIN, desbloqueo, restaurar al empezar
// y configuración inicial de cuentas.

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { pinPad } from '../ui/pinpad.js';
import { notice, tile, textInput, amountInput, field } from '../ui/components.js';
import { confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { restoreForm, describeData } from '../ui/restore.js';
import { pwa, promptInstall, onPwaChange } from '../ui/pwa.js';
import * as vault from '../core/vault.js';
import * as store from '../core/store.js';
import { createInitialState, ValidationError } from '../core/model.js';
import { COLOR_KEYS } from '../core/catalog.js';

let root = null;
let onReady = () => {};
let cleanup = null;

export function initScreens(rootEl, readyCallback) {
  root = rootEl;
  onReady = readyCallback;
}

function screen(children, { top = false, onLeave = null } = {}) {
  cleanup?.();
  cleanup = onLeave;
  document.title = 'Dinero';
  root.className = '';
  replace(root, h('div', { class: ['screen', top && 'top'] }, children));
  window.scrollTo(0, 0);
}

const lead = (title, text) => h('div', { class: 'lead' },
  h('div', { class: 'app-mark', 'aria-hidden': 'true' }, icon('wallet')),
  title,
  text);

const benefit = (iconName, title, text) => h('li', null, icon(iconName), h('div', null, h('strong', null, title), h('span', null, text)));

// --- Bienvenida -------------------------------------------------------------------------------

export function showWelcome() {
  const iosBrowser = pwa.isIOS && !pwa.isStandalone;
  const off = onPwaChange(() => showWelcome());
  screen([
    lead(h('h1', null, 'Dinero'), h('p', { class: 'text' }, 'Tus gastos, cuentas y deudas, en tu móvil y cifrados.')),
    h('ul', { class: 'benefits' },
      benefit('lock', 'Privado', 'Tus datos se guardan solo en este dispositivo. Sin servidores ni registros.'),
      benefit('shield-lock', 'Protegido', 'Un PIN abre la app y todo se guarda cifrado con AES-256.'),
      benefit('device-mobile', 'Sin conexión', 'Funciona aunque no tengas internet.')),
    iosBrowser ? notice({
      iconName: 'alert-triangle',
      kind: 'warn',
      title: 'Primero, instálala en tu iPhone',
      text: 'Pulsa el botón Compartir de Safari y elige «Añadir a pantalla de inicio». Abre la app desde ese icono: si empiezas aquí, en Safari, tus datos no pasarán a la app instalada.',
    }) : null,
    h('div', { class: 'actions' },
      pwa.canPromptInstall ? h('button', { type: 'button', class: 'btn primary', onClick: () => promptInstall() }, icon('download'), 'Instalar la app') : null,
      h('button', {
        type: 'button',
        class: ['btn', !iosBrowser && !pwa.canPromptInstall && 'primary'],
        onClick: () => showCreatePin({ data: createInitialState(), next: 'accounts' }),
      }, iosBrowser || pwa.canPromptInstall ? 'Empezar sin instalar' : 'Empezar'),
      h('button', { type: 'button', class: 'btn', onClick: showRestoreStart }, 'Restaurar una copia de seguridad')),
  ], { onLeave: off });
}

// --- Crear PIN --------------------------------------------------------------------------------

function showCreatePin({ data, next }) {
  let first = null;
  const title = h('h1', { 'aria-live': 'polite' }, 'Crea un PIN');
  const text = h('p', { class: 'text' }, 'Elige 6 números. Lo necesitarás cada vez que abras la app.');
  const pad = pinPad({
    onComplete: async (pin) => {
      if (!first) {
        if (vault.isWeakPin(pin)) {
          pad.error('Ese PIN es muy fácil de adivinar. Elige otro.');
          return;
        }
        first = pin;
        title.textContent = 'Repite el PIN';
        text.textContent = 'Escríbelo otra vez para confirmarlo.';
        pad.info('');
        pad.reset();
        return;
      }
      if (pin !== first) {
        first = null;
        title.textContent = 'Crea un PIN';
        text.textContent = 'Elige 6 números. Lo necesitarás cada vez que abras la app.';
        pad.error('Los PIN no coinciden. Vuelve a empezar.');
        return;
      }
      pad.setBusy(true);
      pad.info('Cifrando tus datos…');
      try {
        await vault.create(pin, store.allBuckets(data));
        store.setState(data);
        if (next === 'accounts') showAccountsSetup();
        else onReady();
      } catch (error) {
        console.error(error);
        first = null;
        pad.setBusy(false);
        pad.error('No se ha podido crear el almacén cifrado. Inténtalo de nuevo.');
      }
    },
  });
  screen([
    lead(title, text),
    pad.el,
    notice({ iconName: 'info-circle', text: 'Si olvidas el PIN no se pueden recuperar los datos. Haz copias de seguridad de vez en cuando.' }),
    h('button', { type: 'button', class: 'btn-text', onClick: showWelcome }, 'Volver'),
  ]);
}

// --- Desbloqueo -------------------------------------------------------------------------------

const mmss = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** Pantalla del PIN. `warning`: aviso a mostrar (p. ej. cambios que no se pudieron guardar). */
export async function showLock({ warning = null } = {}) {
  let timer = null;
  const pad = pinPad({ onComplete: tryUnlock });
  const countdown = (until) => {
    clearInterval(timer);
    pad.setBusy(true);
    // La cuenta atrás corre con el reloj monotónico: cambiar la hora no la altera.
    const end = performance.now() + until - Date.now();
    const waitText = () => `Demasiados intentos. Espera ${mmss(end - performance.now())}.`;
    // Se anuncia al empezar y al terminar; cada segundo solo cambia el texto visible.
    pad.info(waitText());
    timer = setInterval(() => {
      if (end > performance.now()) {
        pad.quiet(waitText());
        return;
      }
      clearInterval(timer);
      pad.setBusy(false);
      pad.info('Ya puedes volver a intentarlo.');
    }, 1000);
  };

  async function tryUnlock(pin) {
    pad.setBusy(true);
    pad.info('Comprobando…');
    let buckets;
    try {
      buckets = await vault.unlock(pin);
    } catch (error) {
      pad.setBusy(false);
      if (error instanceof vault.LockedOutError) {
        pad.reset();
        countdown(error.until);
      } else if (error instanceof vault.WrongPinError) {
        const left = vault.FREE_ATTEMPTS - error.failures;
        pad.error(left > 0 && left <= 3 ? `PIN incorrecto. ${left === 1 ? 'Queda 1 intento' : `Quedan ${left} intentos`} antes de tener que esperar.` : 'PIN incorrecto.');
        if (error.lockedUntil) countdown(error.lockedUntil);
      } else {
        console.error(error);
        pad.error('No se han podido abrir tus datos.');
      }
      return;
    }
    try {
      const dropped = store.loadFromBuckets(buckets);
      clearInterval(timer);
      onReady();
      if (dropped) toast(`Se han descartado ${dropped} elementos dañados.`, { kind: 'error' });
    } catch (error) {
      // PIN correcto pero datos que no se pueden cargar: la clave no se queda en memoria.
      console.error(error);
      vault.lock();
      store.unload();
      pad.error(error instanceof ValidationError ? error.message : 'No se han podido abrir tus datos.');
    }
  }

  screen([
    lead(h('h1', null, 'Introduce tu PIN'), null),
    warning ? notice({ iconName: 'alert-triangle', kind: 'warn', text: warning }) : null,
    pad.el,
    h('button', { type: 'button', class: 'btn-text', onClick: forgotPin }, '¿Has olvidado el PIN?'),
  ], { onLeave: () => clearInterval(timer) });

  try {
    const lockout = await vault.getLockout();
    if (lockout.until > Date.now()) countdown(lockout.until);
  } catch (error) {
    console.error(error); // el desbloqueo volverá a comprobarlo
  }
}

async function forgotPin() {
  const confirmed = await confirmDialog({
    title: '¿Has olvidado el PIN?',
    text: 'Tus datos están cifrados con tu PIN y nadie puede recuperarlo. Si tienes una copia de seguridad, puedes borrar los datos de este dispositivo y restaurarla. Para borrarlos, escribe BORRAR.',
    confirmLabel: 'Borrar datos',
    danger: true,
    requireText: 'BORRAR',
  });
  if (!confirmed) return;
  await vault.destroy();
  store.unload();
  showWelcome();
  toast('Se han borrado los datos de este dispositivo.');
}

// --- Restaurar al empezar ---------------------------------------------------------------------

function showRestoreStart() {
  screen([
    lead(h('h1', null, 'Restaurar copia'), h('p', { class: 'text' }, 'Elige el archivo de tu copia de seguridad y escribe su contraseña.')),
    restoreForm({
      onOpened: ({ data }) => {
        toast(`Copia correcta: ${describeData(data)}. Ahora crea un PIN.`);
        showCreatePin({ data, next: 'app' });
      },
    }),
    h('button', { type: 'button', class: 'btn-text', onClick: showWelcome }, 'Volver'),
  ]);
}

// --- Cuentas iniciales ------------------------------------------------------------------------

function showAccountsSetup() {
  const container = h('div', { class: 'form' });
  const entries = [];

  const addEntry = (account) => {
    const entry = {
      account,
      name: textInput({ value: account?.name ?? '', placeholder: 'Nombre (p. ej. BBVA nómina)', label: 'Nombre de la cuenta' }),
      amount: amountInput({ value: 0, label: 'Saldo actual', allowNegative: true, allowZero: true, compact: true }),
      color: account?.color ?? COLOR_KEYS[(entries.length * 3) % COLOR_KEYS.length],
    };
    const remove = h('button', {
      type: 'button',
      class: 'btn-text danger',
      onClick: () => {
        if (entries.length === 1) {
          toast('Necesitas al menos una cuenta.');
          return;
        }
        entries.splice(entries.indexOf(entry), 1);
        entry.el.remove();
      },
    }, 'Quitar');
    entry.el = h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        tile({ icon: account?.icon ?? 'building-bank', color: entry.color }),
        h('div', { class: 'row-main' }, entry.name),
        remove),
      field('Saldo actual', entry.amount.el, { input: entry.amount.input }));
    entries.push(entry);
    container.append(entry.el);
  };
  store.getState().accounts.forEach(addEntry);

  const finish = () => {
    const values = entries.map((entry) => ({ entry, name: entry.name.value.trim(), amount: entry.amount.read() }));
    const invalid = values.find((v) => !v.name || v.amount === null);
    if (invalid) {
      if (!invalid.name) {
        invalid.entry.name.setAttribute('aria-invalid', 'true');
        invalid.entry.name.focus();
        toast('Pon un nombre a cada cuenta.');
      } else invalid.entry.amount.input.focus();
      return;
    }
    try {
      const keep = new Set(values.map((v) => v.entry.account?.id).filter(Boolean));
      for (const account of [...store.getState().accounts]) if (!keep.has(account.id)) store.deleteAccount(account.id);
      for (const { entry, name, amount } of values) {
        if (entry.account) {
          store.updateAccount(entry.account.id, { name });
          store.setAccountBalance(entry.account.id, amount);
        } else {
          store.addAccount({ name, type: 'bank', icon: 'building-bank', color: entry.color, initial: amount });
        }
      }
      onReady();
    } catch (error) {
      toast(error instanceof ValidationError ? error.message : 'No se han podido guardar las cuentas.', { kind: 'error' });
    }
  };

  screen([
    h('div', { class: 'lead' }, h('h1', null, 'Tus cuentas'),
      h('p', { class: 'text' }, 'Escribe cuánto tienes ahora en cada una. Luego podrás añadir más y cambiar su símbolo, iniciales y color.')),
    container,
    h('button', { type: 'button', class: 'btn', onClick: () => addEntry(null) }, icon('plus'), 'Añadir otra cuenta'),
    h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn primary', onClick: finish }, 'Empezar a usar Dinero')),
  ], { top: true });
}
