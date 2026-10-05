// Copia de seguridad: crear (cifrada con contraseña), restaurar y exportar a CSV.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, field, errorText, notice } from '../ui/components.js';
import { ago } from '../ui/format.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { restoreForm, describeData } from '../ui/restore.js';
import { pauseAutoLock, resetViews } from '../ui/session.js';
import * as store from '../core/store.js';
import { createBackup, toCSV, MIN_PASSWORD_LENGTH } from '../core/backup.js';
import { ValidationError } from '../core/model.js';
import { todayISO } from '../core/dates.js';

/** Guarda un archivo: menú Compartir en móviles (→ «Guardar en Archivos»), descarga en el resto. */
async function saveFile(text, filename, type) {
  const file = new File([text], filename, { type });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    const resume = pauseAutoLock(); // el menú Compartir saca a la persona de la app
    try {
      await navigator.share({ files: [file], title: filename });
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') return false; // la persona canceló
    } finally {
      setTimeout(resume, 1000);
    }
  }
  const url = URL.createObjectURL(file);
  const link = h('a', { href: url, download: filename, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

function openCreateBackup() {
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: `Mínimo ${MIN_PASSWORD_LENGTH} caracteres` });
  const repeat = h('input', { class: 'input', type: 'password', autocomplete: 'off', placeholder: 'Repítela' });
  const error = errorText();
  const prepare = h('button', { type: 'button', class: 'btn primary' }, 'Preparar copia');
  const saveBox = h('div', { class: 'form', hidden: true });
  let prepared = null;

  prepare.addEventListener('click', async () => {
    error.textContent = '';
    if (password.value !== repeat.value) {
      error.textContent = 'Las contraseñas no coinciden.';
      return;
    }
    prepare.setAttribute('aria-busy', 'true');
    prepare.textContent = 'Cifrando…';
    try {
      prepared = await createBackup(store.getState(), password.value);
      password.value = '';
      repeat.value = '';
      prepare.hidden = true;
      saveBox.hidden = false;
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
    } finally {
      prepare.removeAttribute('aria-busy');
      prepare.textContent = 'Preparar copia';
    }
  });

  // Paso separado: compartir un archivo exige un toque reciente de la persona (iOS).
  const saveButton = h('button', { type: 'button', class: 'btn primary' }, icon('download'), 'Guardar archivo');
  saveButton.addEventListener('click', async () => {
    if (!prepared) return;
    if (await saveFile(prepared.text, prepared.filename, 'application/json')) {
      if (!store.isLoaded()) return; // se bloqueó mientras tanto
      store.updateSettings({ lastBackupAt: Date.now() });
      sheet.close();
      toast('Copia de seguridad guardada');
    }
  });
  saveBox.append(
    notice({ iconName: 'circle-check', title: 'Copia lista', text: `Archivo: ${'nummo-copia-' + todayISO() + '.json'}. Guárdalo en Archivos, iCloud Drive o Google Drive.` }),
    saveButton);

  const sheet = openSheet({
    title: 'Crear copia',
    tall: true,
    focus: password,
    body: [
      h('p', { class: 'help' }, 'La copia se cifra con esta contraseña (distinta de tu PIN). Apúntala en un lugar seguro: sin ella no se puede restaurar.'),
      field('Contraseña de la copia', password),
      field('Repite la contraseña', repeat),
      error,
      prepare,
      saveBox,
    ],
  });
}

function openRestore() {
  const sheet = openSheet({
    title: 'Restaurar copia',
    tall: true,
    body: [
      notice({ iconName: 'alert-triangle', kind: 'warn', text: 'Restaurar sustituye todos los datos actuales de la app por los de la copia.' }),
      restoreForm({
        submitLabel: 'Comprobar copia',
        onOpened: async ({ data, exportedAt }) => {
          const when = exportedAt ? ` del ${new Date(exportedAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}` : '';
          const confirmed = await confirmDialog({
            title: '¿Reemplazar tus datos?',
            text: `La copia${when} (${describeData(data)}) sustituirá todo lo que hay ahora en la app.`,
            confirmLabel: 'Reemplazar',
            danger: true,
          });
          if (!confirmed) return;
          try {
            await store.replaceAll(data);
            sheet.close();
            resetViews(); // filtros o meses de los datos anteriores ya no tienen sentido
            const created = store.runRecurring(); // programados pendientes de la copia
            toast(created ? `Copia restaurada. Se han añadido ${created} movimientos programados.` : 'Copia restaurada');
          } catch (error) {
            console.error(error);
            toast('No se ha podido restaurar la copia. Tus datos no han cambiado.', { kind: 'error' });
          }
        },
      }),
    ],
  });
}

async function exportCsv() {
  const confirmed = await confirmDialog({
    title: 'Exportar a CSV',
    text: 'El archivo CSV no va cifrado: cualquiera que lo abra verá tus movimientos. Guárdalo en un lugar seguro.',
    confirmLabel: 'Exportar',
  });
  if (!confirmed) return;
  if (await saveFile(toCSV(store.getState()), `nummo-movimientos-${todayISO()}.csv`, 'text/csv')) toast('CSV exportado');
}

export function backupView() {
  const state = store.getState();
  const last = state.settings.lastBackupAt;
  return {
    title: 'Copia de seguridad',
    back: { label: 'Más', path: '/mas' },
    body: [
      notice({
        iconName: last ? 'circle-check' : 'alert-triangle',
        kind: last ? '' : 'warn',
        title: last ? `Última copia: ${ago(last)}` : 'Aún no tienes ninguna copia',
        text: 'Tus datos solo están en este dispositivo. Haz una copia de vez en cuando y guárdala fuera del móvil (por ejemplo en iCloud Drive).',
      }),
      section({ title: 'Copia cifrada', caption: 'Incluye cuentas, categorías, movimientos, deudas, presupuestos, programados y ajustes.' },
        h('button', { type: 'button', class: 'btn primary', onClick: openCreateBackup }, icon('download'), 'Crear copia')),
      section({ title: 'Restaurar', caption: 'Recupera tus datos desde un archivo de copia (por ejemplo, en un móvil nuevo).' },
        h('button', { type: 'button', class: 'btn', onClick: openRestore }, icon('upload'), 'Restaurar copia')),
      section({ title: 'Excel o Numbers', caption: 'Exporta tus movimientos a una hoja de cálculo. Sin cifrar.' },
        h('button', { type: 'button', class: 'btn', onClick: exportCsv }, icon('file-spreadsheet'), 'Exportar a CSV')),
    ],
  };
}
