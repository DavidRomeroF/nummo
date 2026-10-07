// Bancos: conectar un banco por Open Banking (Enable Banking), vincular sus cuentas, sincronizar,
// renovar el permiso y desconectar; importar extractos; acceso a las reglas y a las transferencias
// entre cuentas propias que hay que confirmar.

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  section, list, row, tile, notice, field, errorText, textInput, toggleRow, selectInput, emptyState,
} from '../ui/components.js';
import { openSheet, confirmDialog } from '../ui/sheet.js';
import { toast } from '../ui/toast.js';
import { rerender } from '../ui/shell.js';
import { agoShort, shortDate, lookups, describeMovement } from '../ui/format.js';
import { pauseAutoLock } from '../ui/session.js';
import * as router from '../ui/router.js';
import * as store from '../core/store.js';
import * as vault from '../core/vault.js';
import { ValidationError } from '../core/model.js';
import { formatMoney } from '../core/money.js';
import { todayISO } from '../core/dates.js';
import { BankError } from '../core/bank/provider.js';
import { KeyFormatError, MAX_PEM_LENGTH } from '../core/bank/jwt.js';
import { syncStatus, MAX_SYNCS_PER_DAY } from '../core/bank/sync.js';
import * as service from '../core/bank/service.js';
import { findTransferCandidates } from '../core/import/plan.js';
import { searchBanks } from '../core/bank/search.js';
import { isTransferText } from '../core/import/rules.js';
import { hashIban, maskIban } from '../core/import/normalize.js';
import { openImportSheet, describeStats } from './import.js';

const syncing = new Set(); // bancos sincronizándose ahora (para el estado en pantalla)
const STATUS_TEXT = { active: 'Conectado', pending: 'Pendiente', expired: 'Permiso caducado', revoked: 'Permiso retirado', error: 'Revisar' };

const errorMessage = (error) => (error instanceof BankError || error instanceof ValidationError || error instanceof KeyFormatError
  ? error.message
  : 'Ha ocurrido un error inesperado.');

/** Texto de estado de un banco para listas y para Inicio. */
export function connectionSummary(connection, now = Date.now()) {
  const status = syncStatus(connection, now);
  if (syncing.has(connection.id)) return { text: 'Sincronizando…', level: '' };
  if (connection.status === 'expired' || status.expired) return { text: 'El permiso ha caducado: vuelve a conectar', level: 'danger' };
  if (connection.status === 'revoked') return { text: 'Permiso retirado: vuelve a conectar', level: 'danger' };
  if (connection.status === 'error') return { text: 'Revisa la configuración de Enable Banking', level: 'danger' };
  const last = connection.lastSyncAt ? `Actualizado ${agoShort(connection.lastSyncAt, now)}` : 'Aún sin sincronizar';
  if (connection.lastError && (!connection.lastSyncAt || connection.lastError.at > connection.lastSyncAt)) {
    return { text: `${last} · último intento fallido`, level: 'warn' };
  }
  if (status.expiresInDays !== null && status.expiresInDays <= 7) {
    return { text: `${last} · el permiso caduca en ${Math.max(status.expiresInDays, 0)} días`, level: 'warn' };
  }
  return { text: last, level: '' };
}

// --- Sincronizar ------------------------------------------------------------------------------

/** Sincroniza un banco mostrando el resultado. Avisa si se supera el límite diario. */
export async function syncWithFeedback(connectionId, { quiet = false } = {}) {
  const connection = store.getState().connections.find((c) => c.id === connectionId);
  if (!connection || syncing.has(connectionId)) return;
  const status = syncStatus(connection);
  if (!quiet && status.overLimit) {
    const go = await confirmDialog({
      title: 'Límite de consultas',
      text: `Hoy ya se ha consultado ${status.attemptsToday} veces. Los bancos suelen permitir unas ${MAX_SYNCS_PER_DAY} al día; si se supera, rechazarán la consulta durante unas horas.`,
      confirmLabel: 'Intentar igualmente',
    });
    if (!go) return;
  }
  syncing.add(connectionId);
  rerender();
  try {
    const result = await service.syncNow(connectionId);
    if (result?.skipped) return;
    if (!quiet || result.stats.added || result.stats.transfers) {
      toast(`${connection.bankName}: ${describeStats(result.stats)}.`);
    }
    if (result.newAccounts.length && !quiet) {
      toast('El banco tiene cuentas que aún no has vinculado. Toca el banco para añadirlas.', { duration: 8000 });
    }
  } catch (error) {
    if (!store.isLoaded()) return;
    if (!quiet || (error instanceof BankError && ['expired', 'revoked', 'app_auth', 'blocked'].includes(error.code))) {
      toast(`${connection.bankName}: ${errorMessage(error)}`, { kind: 'error', duration: 8000 });
    }
  } finally {
    syncing.delete(connectionId);
    if (store.isLoaded()) rerender();
  }
}

/** Al abrir la app: los bancos a los que les toca (cada 6 h, máx. 4 al día). */
export async function autoSyncBanks() {
  const state = store.getState();
  if (!state?.settings.autoSync || !service.getConfig()) return;
  for (const c of state.connections) {
    if (!store.isLoaded()) return;
    if (syncStatus(c).canAuto) await syncWithFeedback(c.id, { quiet: true });
  }
}

// --- Configurar Enable Banking ----------------------------------------------------------------

function openConfigSheet({ then = null } = {}) {
  const current = service.getConfig();
  const appId = textInput({ value: current?.appId ?? '', placeholder: '1a2b3c4d-…', maxLength: 64, capitalize: 'off', label: 'Identificador de la aplicación' });
  // Sin filtro de tipo: Android e iOS no conocen el tipo de un .pem y lo ocultarían en el selector.
  // Se comprueba el contenido, no la extensión.
  const file = h('input', { class: 'input', type: 'file' });
  const pasted = h('textarea', {
    class: 'input mono', rows: 4, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    placeholder: '-----BEGIN PRIVATE KEY-----…', 'aria-label': 'Contenido de la clave privada',
  });
  const proxy = textInput({ value: current?.proxyUrl ?? '', placeholder: 'https://nummo-banco.tu-usuario.workers.dev', maxLength: 140, capitalize: 'off', label: 'Intermediario' });
  const error = errorText();
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Guardar');
  const test = h('button', { type: 'button', class: 'btn' }, icon('refresh'), 'Probar conexión');
  test.addEventListener('click', async () => {
    error.textContent = '';
    test.setAttribute('aria-busy', 'true');
    try {
      const n = await service.testConnection();
      toast(`Conexión correcta: Enable Banking responde (${n} bancos en España).`);
    } catch (e) {
      error.textContent = errorMessage(e);
    } finally {
      test.removeAttribute('aria-busy');
    }
  });
  file.addEventListener('click', () => {
    const resume = pauseAutoLock();
    const done = () => setTimeout(resume, 1000);
    file.addEventListener('change', done, { once: true });
    file.addEventListener('cancel', done, { once: true });
  });
  save.addEventListener('click', async () => {
    error.textContent = '';
    const chosen = file.files?.[0];
    if (!current && !chosen && !pasted.value.trim()) {
      error.textContent = 'Elige el archivo .pem o pega su contenido.';
      return;
    }
    if (chosen && chosen.size > MAX_PEM_LENGTH) {
      error.textContent = 'Ese archivo no parece una clave privada.';
      return;
    }
    save.setAttribute('aria-busy', 'true');
    try {
      await service.saveConfig({ appId: appId.value, pem: chosen ? await chosen.text() : pasted.value, proxyUrl: proxy.value });
      file.value = '';
      pasted.value = '';
      toast('Guardado. Comprobando la conexión…');
      try {
        await service.testConnection();
      } catch (e) {
        error.textContent = errorMessage(e); // se queda abierta para corregir el intermediario
        return;
      }
      sheet.close();
      toast('Enable Banking configurado y respondiendo');
      then?.();
    } catch (e) {
      error.textContent = errorMessage(e);
    } finally {
      save.removeAttribute('aria-busy');
    }
  });
  const sheet = openSheet({
    title: 'Enable Banking',
    tall: true,
    focus: current ? null : appId,
    body: [
      h('p', { class: 'help' }, 'Nummo se conecta a tu banco a través de Enable Banking, un proveedor autorizado de Open Banking. Es gratis para conectar tus propias cuentas. Necesitas crear una vez tu aplicación allí:'),
      h('ol', { class: 'steps' },
        h('li', null, 'Regístrate en enablebanking.com y entra en el panel (Control Panel).'),
        h('li', null, 'En «API applications», crea una aplicación de entorno «Production» y elige generar la clave en el navegador. Se descargará un archivo .pem.'),
        h('li', null, 'En «Redirect URLs» añade exactamente esta dirección:', h('div', { class: 'code-box' }, service.redirectUrl())),
        h('li', null, 'Vincula tus cuentas de Caja Rural en el panel («Link accounts»): en el modo gratuito solo se ven las cuentas vinculadas.'),
        h('li', null, 'Copia aquí el identificador de la aplicación (Application ID) y elige el archivo .pem.'),
        h('li', null, 'Enable Banking no admite llamadas directas desde una web: crea el intermediario gratuito en Cloudflare (ver tools/enablebanking-proxy en el proyecto) y pega aquí su dirección.')),
      field('Identificador de la aplicación', appId),
      field('Clave privada (.pem)', file, { help: 'Se guarda cifrada con tu contraseña y nunca sale de este dispositivo. No se incluye en las copias de seguridad.' }),
      field('O pega aquí su contenido', pasted, { input: pasted, help: current ? 'Déjalo en blanco para conservar la clave que ya está guardada.' : 'Si el móvil no te deja elegir el archivo: ábrelo como texto y copia todo, desde «-----BEGIN» hasta «-----END … KEY-----».' }),
      field('Intermediario (Cloudflare Worker)', proxy, { help: 'Solo reenvía las peticiones; tu clave no sale del móvil. Dirección terminada en .workers.dev.' }),
      error,
      save,
      current ? test : null,
      current ? h('button', {
        type: 'button',
        class: 'btn danger',
        onClick: async () => {
          try {
            await service.forgetConfig();
            sheet.close();
            toast('Configuración borrada');
          } catch (e) {
            error.textContent = errorMessage(e);
          }
        },
      }, 'Olvidar esta aplicación') : null,
    ],
  });
}

// --- Conectar un banco --------------------------------------------------------------------------

async function startConnect({ reconnect = null } = {}) {
  if (vault.currentSecretKind() !== 'password') {
    const go = await confirmDialog({
      title: 'Primero, una contraseña',
      text: 'Para guardar el acceso a tu banco, Nummo tiene que abrirse con una contraseña en lugar del PIN de 6 cifras. Puedes cambiarlo en Seguridad.',
      confirmLabel: 'Ir a Seguridad',
    });
    if (go) router.navigate('/mas/seguridad');
    return;
  }
  if (!service.getConfig()) {
    openConfigSheet({ then: () => startConnect({ reconnect }) });
    return;
  }
  if (reconnect) {
    confirmAndGo({ name: reconnect.bankName, country: reconnect.country, maxConsentDays: 180 }, reconnect.id);
    return;
  }
  openBankPicker();
}

function openBankPicker() {
  const search = textInput({ placeholder: 'Escribe el nombre (p. ej. Caixalmassora)', maxLength: 40, label: 'Buscar banco' });
  const results = h('div', { 'aria-live': 'polite' }, h('p', { class: 'help' }, 'Cargando bancos…'));
  let banks = [];
  const render = () => {
    const found = searchBanks(banks, search.value);
    const shown = found.slice(0, 80);
    replace(results, shown.length
      ? [h('p', { class: 'help' }, search.value.trim()
        ? `${found.length} ${found.length === 1 ? 'banco' : 'bancos'}`
        : `${banks.length} bancos disponibles en España. Escribe para buscar.`), list(shown.map((b) => row({
        lead: tile({ icon: 'building-bank', color: 'green' }),
        title: b.name,
        subtitle: b.beta ? 'Integración reciente (beta)' : null,
        chevron: true,
        onClick: () => {
          sheet.close();
          confirmAndGo(b);
        },
      })))]
      : h('p', { class: 'help' }, 'No hay ningún banco con ese nombre. Prueba con otra parte del nombre (por ejemplo «Almassora» o «Rural»).'));
  };
  search.addEventListener('input', render);
  const sheet = openSheet({ title: 'Elige tu banco', tall: true, focus: search, body: [field('Banco', search), results] });
  service.getProvider()
    .then((p) => p.listBanks(service.DEFAULT_COUNTRY))
    .then((list_) => {
      banks = list_;
      render();
    })
    .catch((e) => replace(results, notice({ iconName: 'alert-triangle', kind: 'warn', text: errorMessage(e) })));
}

async function confirmAndGo(bank, reconnectId = null) {
  const days = Math.min(180, bank.maxConsentDays || 180);
  const ok = await confirmDialog({
    title: `Conectar ${bank.name}`,
    text: `Irás a la web o app de tu banco para identificarte allí (Nummo nunca ve tu usuario ni tu contraseña). Darás permiso de solo lectura, durante ${days} días, para ver tus cuentas, saldos y movimientos. Puedes retirarlo cuando quieras.`,
    confirmLabel: 'Ir al banco',
  });
  if (!ok) return;
  try {
    const url = await service.beginConnect({ bankName: bank.name, country: bank.country, maxConsentDays: days, reconnectId });
    pauseAutoLock(10 * 60_000);
    location.assign(url); // la app se recarga al volver del banco con ?code=…&state=…
  } catch (e) {
    toast(errorMessage(e), { kind: 'error', duration: 8000 });
  }
}

/** Vuelta del banco (main.js la detecta al arrancar): termina la conexión y vincula las cuentas. */
export async function handleBankCallback(callback) {
  router.navigate('/mas/bancos');
  const busy = openSheet({ title: 'Conectando…', body: [h('p', { class: 'help', 'aria-live': 'polite' }, 'Recibiendo el permiso del banco…')] });
  try {
    const { connection, accounts } = await service.completeConnect(callback);
    busy.close(true);
    await openLinkAccounts(connection, accounts);
  } catch (e) {
    busy.close(true);
    if (e instanceof BankError && e.detail === 'OTHER_INSTALL') openFinishElsewhere(callback);
    else toast(errorMessage(e), { kind: 'error', duration: 8000 });
  }
}

/**
 * El banco ha vuelto a una instalación de Nummo distinta de la que empezó la conexión (por ejemplo,
 * al navegador en lugar de a la app instalada: tienen datos separados). Se ofrece copiar la dirección
 * de vuelta para terminar en la otra.
 */
function openFinishElsewhere(callback) {
  const params = new URLSearchParams(Object.entries(callback).filter(([, v]) => v));
  const back = `${service.redirectUrl()}?${params}`;
  const copy = h('button', { type: 'button', class: 'btn primary' }, 'Copiar dirección');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(back);
      copy.textContent = 'Copiada';
    } catch {
      copy.textContent = 'Selecciónala y cópiala a mano';
    }
  });
  openSheet({
    title: 'Termina en la otra app',
    tall: true,
    body: [
      notice({ iconName: 'alert-triangle', kind: 'warn', text: 'La conexión con el banco se empezó en otra instalación de Nummo (por ejemplo, la app instalada) y el banco te ha devuelto aquí. Cada una guarda sus datos por separado.' }),
      h('ol', { class: 'steps' },
        h('li', null, 'Copia esta dirección.'),
        h('li', null, 'Abre la Nummo donde empezaste a conectar.'),
        h('li', null, 'Ve a Más → Bancos y extractos → «Pegar la dirección de vuelta del banco». Tienes unos minutos.')),
      h('p', { class: 'code-box' }, back),
      copy,
      h('p', { class: 'help' }, 'Consejo: usa el banco solo en una de las dos. El banco solo admite un permiso a la vez, y conectar en una anula el de la otra.'),
    ],
  });
}

/** Elegir qué cuentas del banco vincular y con qué cuenta de Nummo. */
async function openLinkAccounts(connection, bankAccounts) {
  const state = store.getState();
  const mine = state.accounts.filter((a) => !a.archived);
  const NEW = '__new__';
  const SKIP = '';
  const rows = [];
  for (const ba of bankAccounts) {
    const hash = await hashIban(ba.iban);
    const already = mine.find((a) => a.bank?.connectionId === connection.id && a.bank.externalId === ba.externalId);
    const byIban = hash ? mine.find((a) => a.bank?.ibanHash === hash) : null;
    const preset = already?.id ?? byIban?.id ?? NEW;
    const name = textInput({ value: ba.name || 'Cuenta', maxLength: 40, label: 'Nombre de la cuenta nueva' });
    const { el, select } = selectInput([
      { value: NEW, label: 'Crear una cuenta nueva' },
      ...mine.map((a) => ({ value: a.id, label: `${a.name}${a.bank?.ibanMasked ? ` (${a.bank.ibanMasked})` : ''}` })),
      { value: SKIP, label: 'No vincular' },
    ], preset, { label: `Cuenta para ${maskIban(ba.iban) || ba.name}` });
    const nameField = field('Nombre en Nummo', name, { help: 'Por ejemplo «Cuenta principal» o «Ahorros».' });
    nameField.hidden = preset !== NEW;
    select.addEventListener('change', () => { nameField.hidden = select.value !== NEW; });
    rows.push({ ba, select, name });
    rows.at(-1).el = h('div', { class: 'card form' },
      h('div', { class: 'card-head' }, tile({ icon: 'building-bank', color: 'green' }),
        h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, ba.name || 'Cuenta'), h('span', { class: 'row-sub mono' }, maskIban(ba.iban) || ba.currency))),
      field('Vincular con', el, { input: select }), nameField);
  }
  const error = errorText();
  const save = h('button', { type: 'button', class: 'btn primary' }, 'Guardar y sincronizar');
  save.addEventListener('click', async () => {
    error.textContent = '';
    const choices = rows.filter((r) => r.select.value !== SKIP)
      .map((r) => ({ bankAccount: r.ba, accountId: r.select.value === NEW ? null : r.select.value, name: r.name.value.trim() }));
    const targets = choices.map((c) => c.accountId).filter(Boolean);
    if (new Set(targets).size !== targets.length) {
      error.textContent = 'Cada cuenta del banco debe ir a una cuenta distinta de Nummo.';
      return;
    }
    try {
      await service.linkAccounts(connection.id, choices);
      sheet.close();
      syncWithFeedback(connection.id);
    } catch (e) {
      error.textContent = errorMessage(e);
    }
  });
  const sheet = openSheet({
    title: 'Tus cuentas',
    tall: true,
    body: bankAccounts.length
      ? [h('p', { class: 'help' }, `${connection.bankName} ha dado acceso a estas cuentas. Si ya tenías la cuenta en Nummo, vincúlala para no duplicar movimientos.`), rows.map((r) => r.el), error, save]
      : [notice({ iconName: 'alert-triangle', kind: 'warn', text: 'El banco no ha devuelto ninguna cuenta. En el modo gratuito de Enable Banking, vincula antes tus cuentas en su panel («Link accounts») y vuelve a conectar.' })],
  });
}

/** Plan B si el banco volvió al navegador en lugar de a la app instalada (iPhone). */
function openPasteReturn() {
  const input = textInput({ placeholder: 'https://…?code=…&state=…', maxLength: 2600, capitalize: 'off', label: 'Dirección de vuelta' });
  const error = errorText();
  const go = h('button', { type: 'button', class: 'btn primary' }, 'Continuar');
  go.addEventListener('click', () => {
    const callback = service.parseReturnUrl(input.value);
    if (!callback) {
      error.textContent = 'Esa dirección no parece la de vuelta del banco.';
      return;
    }
    input.value = '';
    sheet.close(true);
    handleBankCallback(callback);
  });
  const sheet = openSheet({
    title: 'Dirección de vuelta',
    focus: input,
    body: [h('p', { class: 'help' }, 'Si al terminar en el banco se abrió el navegador en vez de la app, copia allí la dirección que te muestra Nummo y pégala aquí.'), field('Dirección', input), error, go],
  });
}

// --- Detalle de un banco ----------------------------------------------------------------------

function openConnectionSheet(connection) {
  const state = store.getState();
  const accounts = state.accounts.filter((a) => a.bank?.connectionId === connection.id);
  const balances = store.derived().summary.balances;
  const status = syncStatus(connection);
  const summary = connectionSummary(connection);
  const disconnect = async () => {
    const ok = await confirmDialog({
      title: `¿Desconectar ${connection.bankName}?`,
      text: 'Se retirará el permiso en el banco. Las cuentas se quedan en Nummo como cuentas manuales, con su historial.',
      confirmLabel: 'Desconectar',
      danger: true,
    });
    if (!ok) return;
    const wipe = await confirmDialog({
      title: '¿Borrar también sus movimientos?',
      text: 'Puedes conservar los movimientos que vinieron del banco o borrarlos de Nummo.',
      confirmLabel: 'Borrarlos',
      danger: true,
    });
    try {
      const { revoked } = await service.disconnect(connection.id, { deleteMovements: wipe });
      sheet.close();
      toast(revoked ? 'Banco desconectado y permiso retirado' : 'Banco desconectado. No se pudo avisar al banco: el permiso caducará solo o puedes retirarlo en su web.', { duration: 8000 });
    } catch (e) {
      toast(errorMessage(e), { kind: 'error' });
    }
  };
  const sheet = openSheet({
    title: connection.bankName,
    tall: true,
    body: [
      notice({
        iconName: summary.level ? 'alert-triangle' : 'circle-check',
        kind: summary.level === 'danger' ? 'danger' : summary.level,
        title: STATUS_TEXT[status.expired ? 'expired' : connection.status],
        text: summary.text,
      }),
      list([
        row({ title: 'Permiso válido hasta', value: connection.validUntil ? shortDate(todayISO(new Date(connection.validUntil))) : '—' }),
        row({ title: 'Consultas en las últimas 24 h', value: `${status.attemptsToday} de ${MAX_SYNCS_PER_DAY}` }),
        connection.lastError ? row({
          title: 'Último error',
          subtitle: [errorMessage(new BankError(connection.lastError.code)), connection.lastError.detail ? `Código técnico: ${connection.lastError.detail}` : null].filter(Boolean).join(' · '),
          value: agoShort(connection.lastError.at),
        }) : null,
      ]),
      section({ title: 'Cuentas vinculadas' }, accounts.length
        ? list(accounts.map((a) => row({
          lead: tile(a),
          title: a.name,
          subtitle: [a.bank.ibanMasked, a.bank.balanceAt ? `saldo del banco el ${shortDate(a.bank.balanceAt)}` : null].filter(Boolean).join(' · '),
          value: formatMoney(balances.get(a.id) ?? 0),
        })))
        : h('p', { class: 'help' }, 'Ninguna. Vuelve a conectar para elegir cuentas.')),
      h('button', { type: 'button', class: 'btn primary', onClick: () => { sheet.close(); syncWithFeedback(connection.id); } }, icon('refresh'), 'Sincronizar ahora'),
      h('button', { type: 'button', class: 'btn', onClick: () => { sheet.close(); startConnect({ reconnect: connection }); } }, icon('key'), 'Renovar permiso o añadir cuentas'),
      h('button', { type: 'button', class: 'btn danger', onClick: disconnect }, 'Desconectar banco'),
    ],
  });
}

// --- Transferencias por confirmar ---------------------------------------------------------------

function openTransferCandidates(candidates) {
  const state = store.getState();
  const look = lookups(state);
  const byId = new Map(state.movements.map((m) => [m.id, m]));
  const box = h('div', { class: 'form' });
  const render = () => replace(box, candidates.length
    ? candidates.map((c, i) => {
      const e = byId.get(c.expenseId);
      const inc = byId.get(c.incomeId);
      const a = describeMovement(e, look);
      const b = describeMovement(inc, look);
      return h('div', { class: 'card form' },
        list([
          row({ title: look.accounts.get(e.accountId)?.name ?? '—', subtitle: `${shortDate(e.date)} · ${e.note}`, value: a.amount }),
          row({ title: look.accounts.get(inc.accountId)?.name ?? '—', subtitle: `${shortDate(inc.date)} · ${inc.note}`, value: b.amount, valueClass: 'pos' }),
        ], { plain: true }),
        h('div', { class: 'toolbar' },
          h('button', { type: 'button', class: 'btn primary', onClick: () => { store.mergeTransfer(c.expenseId, c.incomeId); candidates.splice(i, 1); render(); toast('Unidos como transferencia'); } }, icon('arrows-exchange'), 'Es una transferencia'),
          h('button', { type: 'button', class: 'btn', onClick: () => { candidates.splice(i, 1); render(); } }, 'No')));
    })
    : emptyState('circle-check', 'Nada pendiente', 'No quedan posibles transferencias por revisar.'));
  render();
  openSheet({
    title: 'Transferencias propias',
    tall: true,
    body: [h('p', { class: 'help' }, 'Un gasto en una cuenta y un ingreso igual en otra tuya, en fechas cercanas. Si es dinero que solo cambia de cuenta, únelos: así no cuenta como gasto ni como ingreso.'), box],
  });
}

// --- Vista ----------------------------------------------------------------------------------

export function banksView() {
  const state = store.getState();
  const config = service.getConfig();
  const usesPassword = vault.currentSecretKind() === 'password';
  const candidates = findTransferCandidates(state, { isTransferText });
  const rulesCount = state.rules.length;

  return {
    title: 'Bancos',
    back: { label: 'Más', path: '/mas' },
    body: [
      !usesPassword ? notice({
        iconName: 'shield-lock',
        title: 'Conectar un banco requiere contraseña',
        text: 'Para guardar el acceso a tu banco, Nummo debe abrirse con una contraseña en lugar del PIN. La importación de extractos funciona igualmente.',
        actions: [{ label: 'Ir a Seguridad', primary: true, onClick: () => router.navigate('/mas/seguridad') }],
      }) : null,
      section({ title: 'Bancos conectados', caption: 'Solo lectura, mediante Open Banking (PSD2). Nummo nunca ve tus claves del banco.' },
        state.connections.length
          ? list(state.connections.map((c) => {
            const s = connectionSummary(c);
            const linked = state.accounts.filter((a) => a.bank?.connectionId === c.id).length;
            return row({
              lead: tile({ icon: 'building-bank', color: s.level === 'danger' ? 'red' : 'green' }),
              title: c.bankName,
              subtitle: `${s.text} · ${linked} ${linked === 1 ? 'cuenta' : 'cuentas'}`,
              trailing: syncing.has(c.id) ? h('span', { class: 'badge' }, 'Sincronizando') : null,
              chevron: true,
              onClick: () => openConnectionSheet(c),
            });
          }))
          : h('div', { class: 'card' }, emptyState('building-bank', 'Ningún banco conectado', 'Conecta tu banco para que tus movimientos lleguen solos.'))),
      h('button', { type: 'button', class: 'btn primary', onClick: () => startConnect() }, icon('plus'), 'Conectar un banco'),
      store.getSecrets()?.pending ? h('button', { type: 'button', class: 'btn-text', onClick: openPasteReturn }, 'Pegar la dirección de vuelta del banco') : null,
      section({ title: 'Extractos', caption: 'Si tu banco no se puede conectar, descarga los movimientos en Excel o CSV desde su web e impórtalos. No se duplican aunque importes el mismo periodo dos veces.' },
        h('button', { type: 'button', class: 'btn', onClick: () => openImportSheet() }, icon('file-spreadsheet'), 'Importar extracto')),
      section({ title: 'Organizar' }, list([
        row({ lead: tile({ icon: 'tag', color: 'orange' }), title: 'Reglas de categorías', subtitle: 'Mercadona → Supermercado…', value: rulesCount ? String(rulesCount) : null, chevron: true, onClick: () => router.navigate('/mas/reglas') }),
        candidates.length
          ? row({ lead: tile({ icon: 'arrows-exchange', color: 'graphite' }), title: 'Posibles transferencias entre tus cuentas', value: String(candidates.length), chevron: true, onClick: () => openTransferCandidates(candidates) })
          : null,
      ])),
      section({ title: 'Ajustes', caption: `Los bancos permiten unas ${MAX_SYNCS_PER_DAY} consultas al día. Nummo es una web: no puede actualizarse con la app cerrada, así que lo hace al abrirla, como mucho cada 6 horas.` },
        list([
          toggleRow('Sincronizar al abrir la app', state.settings.autoSync, (checked) => store.updateSettings({ autoSync: checked })),
          row({ lead: icon('key'), title: 'Aplicación de Enable Banking', subtitle: config ? `ID ${config.appId.slice(0, 8)}…` : 'Sin configurar', chevron: true, onClick: () => (usesPassword ? openConfigSheet() : startConnect()) }),
        ], { plain: true })),
    ],
  };
}
