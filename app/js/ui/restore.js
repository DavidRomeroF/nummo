// Formulario para abrir una copia de seguridad (al empezar o desde «Copia de seguridad»).
// Solo descifra y valida: quien lo usa decide qué hacer con los datos.

import { h } from './dom.js';
import { field, errorText } from './components.js';
import { parseBackup, openBackup, BackupPasswordError, MAX_BACKUP_BYTES } from '../core/backup.js';
import { ValidationError } from '../core/model.js';

export function restoreForm({ onOpened, submitLabel = 'Abrir copia' }) {
  const file = h('input', { class: 'input', type: 'file', accept: '.json,application/json' });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Contraseña de la copia', enterkeyhint: 'go' });
  const error = errorText();
  const button = h('button', { type: 'button', class: 'btn primary' }, submitLabel);

  async function submit() {
    error.textContent = '';
    const chosen = file.files?.[0];
    if (!chosen) {
      error.textContent = 'Elige el archivo de la copia (dinero-copia-….json).';
      return;
    }
    if (chosen.size > MAX_BACKUP_BYTES) {
      error.textContent = 'El archivo es demasiado grande para ser una copia de esta app.';
      return;
    }
    if (!password.value) {
      error.textContent = 'Escribe la contraseña de la copia.';
      password.focus();
      return;
    }
    button.setAttribute('aria-busy', 'true');
    button.textContent = 'Comprobando…';
    try {
      const opened = await openBackup(parseBackup(await chosen.text()), password.value);
      password.value = '';
      onOpened(opened);
    } catch (e) {
      if (e instanceof BackupPasswordError) error.textContent = 'La contraseña no es correcta o el archivo está dañado.';
      else if (e instanceof ValidationError) error.textContent = e.message;
      else {
        console.error(e);
        error.textContent = 'No se ha podido leer el archivo.';
      }
    } finally {
      button.removeAttribute('aria-busy');
      button.textContent = submitLabel;
    }
  }

  button.addEventListener('click', submit);
  password.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });
  return h('div', { class: 'form' }, field('Archivo de copia', file), field('Contraseña', password), error, button);
}

/** Resumen legible de unos datos restaurados. */
export function describeData(data) {
  const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  return [
    n(data.accounts.length, 'cuenta', 'cuentas'),
    n(data.movements.length, 'movimiento', 'movimientos'),
    n(data.debts.length, 'deuda', 'deudas'),
  ].join(', ');
}
