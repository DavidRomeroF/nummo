// Importar un extracto del banco (Excel o CSV): elegir archivo → reconocer columnas → elegir cuenta
// → vista previa (nuevos, ya importados, transferencias) → importar, con «Deshacer».
// Usa la misma tubería que la sincronización con el banco (core/import/).

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { field, errorText, notice, list, row, toggleRow, selectInput } from '../ui/components.js';
import { openSheet } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { pauseAutoLock } from '../ui/session.js';
import { shortDate } from '../ui/format.js';
import * as store from '../core/store.js';
import { newId } from '../core/ids.js';
import { ValidationError } from '../core/model.js';
import { formatMoney } from '../core/money.js';
import { readStatementFile, MAX_FILE_BYTES } from '../core/import/files.js';
import { detectLayout, tableToRaws, FIELDS } from '../core/import/statement.js';
import { prepareItems, hashIban, maskIban } from '../core/import/normalize.js';
import { planImport } from '../core/import/plan.js';

const FIELD_LABELS = {
  date: 'Fecha (contable u operación)',
  vdate: 'Fecha valor (opcional)',
  text: 'Concepto',
  amount: 'Importe (con signo)',
  debit: 'Cargos (si van en columna aparte)',
  credit: 'Abonos (si van en columna aparte)',
  balance: 'Saldo tras el movimiento (opcional)',
  ext: 'Nº de apunte o referencia (opcional)',
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Resumen de una importación para el aviso final. */
export function describeStats(stats) {
  const parts = [];
  if (stats.added) parts.push(plural(stats.added, 'movimiento nuevo', 'movimientos nuevos'));
  if (stats.transfers) parts.push(plural(stats.transfers, 'transferencia entre tus cuentas', 'transferencias entre tus cuentas'));
  if (stats.linked) parts.push(plural(stats.linked, 'ya apuntado a mano', 'ya apuntados a mano'));
  if (stats.confirmed) parts.push(plural(stats.confirmed, 'pendiente confirmado', 'pendientes confirmados'));
  if (stats.removedPending) parts.push(plural(stats.removedPending, 'pendiente anulado', 'pendientes anulados'));
  return parts.length ? parts.join(', ') : 'No había movimientos nuevos';
}

export function openImportSheet({ accountId = null } = {}) {
  // Sin filtro de tipo: algunos móviles ocultan archivos válidos si el banco no les puso bien el tipo.
  // El formato se reconoce por el contenido.
  const fileInput = h('input', { class: 'input', type: 'file' });
  const error = errorText();
  const step = h('div', { class: 'form' });
  const readButton = h('button', { type: 'button', class: 'btn primary' }, icon('file-spreadsheet'), 'Leer archivo');
  let busy = false;

  fileInput.addEventListener('click', () => {
    const resume = pauseAutoLock(); // el selector de archivos saca a la persona de la app
    const done = () => setTimeout(resume, 1000);
    fileInput.addEventListener('change', done, { once: true });
    fileInput.addEventListener('cancel', done, { once: true });
  });

  async function read() {
    if (busy) return;
    error.textContent = '';
    const chosen = fileInput.files?.[0];
    if (!chosen) {
      error.textContent = 'Elige el archivo que has descargado de tu banco.';
      return;
    }
    if (chosen.size > MAX_FILE_BYTES) {
      error.textContent = 'El archivo es demasiado grande (máximo 10 MB).';
      return;
    }
    busy = true;
    readButton.setAttribute('aria-busy', 'true');
    try {
      const table = await readStatementFile(new Uint8Array(await chosen.arrayBuffer()));
      const layout = detectLayout(table.rows);
      showColumns(table, layout);
    } catch (e) {
      if (!(e instanceof ValidationError)) {
        console.error(e?.name); // nunca el contenido del archivo
        error.textContent = 'No se ha podido leer el archivo.';
      } else {
        error.textContent = e.message;
      }
    } finally {
      busy = false;
      readButton.removeAttribute('aria-busy');
    }
  }
  readButton.addEventListener('click', read);

  /** Paso 2: columnas. Si se han reconocido todas, pasa directamente a la cuenta. */
  function showColumns(table, layout) {
    const complete = layout.columns.date !== undefined && layout.columns.text !== undefined
      && (layout.columns.amount !== undefined || (layout.columns.debit !== undefined && layout.columns.credit !== undefined));
    if (complete) {
      showAccount(table, layout);
      return;
    }
    if (layout.headerRow < 0 || !layout.headers.length) {
      error.textContent = 'No encuentro una tabla de movimientos en el archivo.';
      return;
    }
    const selects = {};
    const controls = FIELDS.map((f) => {
      const options = layout.headers.map((name, i) => ({ value: String(i), label: name || `Columna ${i + 1}` }));
      const { el, select } = selectInput(options, layout.columns[f] === undefined ? '' : String(layout.columns[f]), { placeholder: '—' });
      selects[f] = select;
      return field(FIELD_LABELS[f], el, { input: select });
    });
    const next = h('button', { type: 'button', class: 'btn primary' }, 'Continuar');
    next.addEventListener('click', () => {
      const columns = {};
      for (const f of FIELDS) if (selects[f].value !== '') columns[f] = Number(selects[f].value);
      showAccount(table, { ...layout, columns });
    });
    replace(step,
      notice({ iconName: 'info-circle', text: 'No reconozco todas las columnas de este archivo. Indica cuál es cada una.' }),
      controls, next);
  }

  /** Paso 3: cuenta de destino y vista previa. */
  async function showAccount(table, layout) {
    let raws;
    let rejectedRows;
    try {
      ({ raws, rejected: rejectedRows } = tableToRaws(table.rows, layout, table));
    } catch (e) {
      if (!(e instanceof ValidationError)) throw e;
      error.textContent = e.message;
      return;
    }
    if (!raws.length) {
      error.textContent = 'El archivo no tiene movimientos que se puedan importar.';
      return;
    }
    const { items, rejected } = await prepareItems(raws);
    const ibanHash = layout.iban ? await hashIban(layout.iban) : '';
    const state = store.getState();
    const accounts = state.accounts.filter((a) => !a.archived);
    const byIban = ibanHash ? accounts.find((a) => a.bank?.ibanHash === ibanHash) : null;
    const draft = { accountId: byIban?.id ?? accountId ?? null, follow: true };
    const hasBalance = items.some((i) => i.bal !== null);
    const dates = items.map((i) => i.bdate).sort();
    const preview = h('div', { class: 'form', 'aria-live': 'polite' });
    const NEW = '__new__';
    const bankLabel = layout.template?.name ?? 'Banco';
    const newName = `${layout.template?.id === 'ruralvia' ? 'Ruralvía' : 'Cuenta'}${layout.iban ? ` ${maskIban(layout.iban).slice(-4)}` : ''}`;

    const { el: selectEl, select } = selectInput([
      ...accounts.map((a) => ({ value: a.id, label: `${a.name}${a.bank?.ibanMasked ? ` (${a.bank.ibanMasked})` : ''}` })),
      { value: NEW, label: `Crear cuenta nueva «${newName}»` },
    ], draft.accountId ?? '', { placeholder: 'Elige una cuenta…' });
    select.addEventListener('change', () => {
      draft.accountId = select.value || null;
      renderPreview();
    });

    function plan() {
      if (!draft.accountId || draft.accountId === NEW) return null;
      return planImport(store.getState(), items, { accountId: draft.accountId, kind: 'file', batch: 'preview0000', newId, now: Date.now() });
    }

    function renderPreview() {
      const p = plan();
      if (!draft.accountId) {
        replace(preview);
        return;
      }
      const s = p?.stats ?? { added: items.length, duplicates: 0, transfers: 0, linked: 0, confirmed: 0 };
      const rows = [
        row({ title: 'Movimientos nuevos', value: String(s.added) }),
        s.duplicates ? row({ title: 'Ya estaban importados', subtitle: 'No se duplican', value: String(s.duplicates) }) : null,
        s.linked ? row({ title: 'Ya apuntados a mano', subtitle: 'Se completan con los datos del banco', value: String(s.linked) }) : null,
        s.transfers ? row({ title: 'Transferencias entre tus cuentas', value: String(s.transfers) }) : null,
        rejected + rejectedRows ? row({ title: 'Filas que no se pueden leer', subtitle: 'Se ignoran', value: String(rejected + rejectedRows) }) : null,
      ];
      replace(preview,
        list(rows),
        p?.balance ? h('p', { class: 'help' }, `Saldo del banco el ${shortDate(p.balance.date)}: ${formatMoney(p.balance.amount)}.`) : null);
    }

    const go = h('button', { type: 'button', class: 'btn primary' }, icon('download'), 'Importar');
    go.addEventListener('click', () => {
      error.textContent = '';
      if (!draft.accountId) {
        error.textContent = 'Elige en qué cuenta importar los movimientos.';
        return;
      }
      try {
        let target = draft.accountId;
        if (target === NEW) {
          target = store.addAccount({ name: newName, type: 'bank', icon: 'building-bank', color: 'green', initial: 0 }).id;
        }
        const batch = newId();
        const p = planImport(store.getState(), items, { accountId: target, kind: 'file', batch, newId, now: Date.now() });
        const bank = layout.iban ? { ibanHash, ibanMasked: maskIban(layout.iban) } : null;
        const result = store.applyImport(p, { accountId: target, batch, bank, balance: hasBalance ? p.balance : null, followBalance: draft.follow });
        sheet.close();
        toast(`${bankLabel}: ${describeStats(result.stats)}.`, {
          duration: 8000,
          action: result.stats.added + result.stats.transfers + result.stats.linked > 0
            ? { label: 'Deshacer', onClick: () => store.undoImport(batch) }
            : null,
        });
      } catch (e) {
        if (!(e instanceof ValidationError)) throw e;
        error.textContent = e.message;
      }
    });

    replace(step,
      notice({
        iconName: 'circle-check',
        title: layout.template ? `Extracto de ${layout.template.name}` : 'Extracto leído',
        text: `${plural(items.length, 'movimiento', 'movimientos')} del ${shortDate(dates[0])} al ${shortDate(dates.at(-1))}${layout.iban ? ` · cuenta ${maskIban(layout.iban)}` : ''}.`,
      }),
      field('Importar en', selectEl, { input: select, help: byIban ? 'Reconocida por el IBAN del extracto.' : 'Si es la primera vez, puedes crear una cuenta nueva.' }),
      hasBalance ? list([toggleRow('Ajustar el saldo al del banco', draft.follow, (checked) => { draft.follow = checked; }, {
        help: 'El saldo de la cuenta en Nummo pasará a coincidir con el del extracto.',
      })], { plain: true }) : null,
      preview,
      go);
    renderPreview();
  }

  replace(step,
    h('p', { class: 'help' }, 'Descarga los movimientos desde la web o la app de tu banco (Excel o CSV) y elígelos aquí. El archivo se lee en este dispositivo: no se envía a ningún sitio.'),
    field('Archivo del banco', fileInput),
    readButton);

  const sheet = openSheet({ title: 'Importar extracto', tall: true, body: [step, error] });
}
