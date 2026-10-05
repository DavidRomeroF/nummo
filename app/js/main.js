// Arranque: comprobaciones de seguridad, PWA, ciclo de vida (bloqueo automático) y rutas.

import { h, replace } from './ui/dom.js';
import { icon } from './ui/icons.js';
import * as router from './ui/router.js';
import { mountShell, unmountShell } from './ui/shell.js';
import { closeAllSheets } from './ui/sheet.js';
import { toast, clearToasts } from './ui/toast.js';
import { initPwa, checkForUpdate, requestPersistence } from './ui/pwa.js';
import { onSession } from './ui/session.js';
import { initScreens, showWelcome, showLock } from './views/screens.js';
import { homeView } from './views/home.js';
import { movementsView } from './views/movements.js';
import { debtsView, debtDetailView } from './views/debts.js';
import { statsView } from './views/stats.js';
import { moreView } from './views/more.js';
import { accountsView } from './views/accounts.js';
import { categoriesView } from './views/categories.js';
import { budgetsView } from './views/budgets.js';
import { recurringView } from './views/recurring.js';
import { backupView } from './views/backup.js';
import { securityView } from './views/security.js';
import { aboutView } from './views/about.js';
import * as vault from './core/vault.js';
import * as store from './core/store.js';
import { isCryptoAvailable } from './core/crypto.js';
import { todayISO } from './core/dates.js';

const appRoot = document.getElementById('app');
const html = document.documentElement;
let hiddenAt = 0;
let lastRecurringDay = null;

router.addRoute('/', homeView, 'inicio');
router.addRoute('/movimientos', movementsView, 'movimientos');
router.addRoute('/deudas', debtsView, 'deudas');
router.addRoute('/deudas/:id', debtDetailView, 'deudas');
router.addRoute('/analisis', statsView, 'analisis');
router.addRoute('/mas', moreView, 'mas');
router.addRoute('/mas/cuentas', accountsView, 'mas');
router.addRoute('/mas/categorias', categoriesView, 'mas');
router.addRoute('/mas/presupuestos', budgetsView, 'mas');
router.addRoute('/mas/programados', recurringView, 'mas');
router.addRoute('/mas/copias', backupView, 'mas');
router.addRoute('/mas/seguridad', securityView, 'mas');
router.addRoute('/mas/acerca', aboutView, 'mas');

function fatal(title, text) {
  replace(appRoot, h('div', { class: 'screen' },
    h('div', { class: 'lead' }, h('div', { class: 'app-mark', 'aria-hidden': 'true' }, icon('alert-triangle')), h('h1', null, title)),
    h('p', { class: 'text' }, text)));
}

const autoLockSeconds = () => store.getState()?.settings.autoLockSec ?? 60;

/** Crea los movimientos programados pendientes (una vez al día como mucho). */
function runRecurring() {
  const today = todayISO();
  if (today === lastRecurringDay) return;
  lastRecurringDay = today;
  try {
    const created = store.runRecurring(today);
    if (created) toast(created === 1 ? 'Se ha añadido 1 movimiento programado.' : `Se han añadido ${created} movimientos programados.`);
  } catch (error) {
    console.error(error);
  }
}

function enterApp() {
  lastRecurringDay = null;
  mountShell(appRoot);
  runRecurring();
  requestPersistence();
}

async function lockApp() {
  if (!vault.isUnlocked()) return;
  try {
    await store.flush();
  } catch {
    /* el fallo ya se ha avisado; se bloquea igualmente */
  }
  closeAllSheets();
  clearToasts();
  unmountShell();
  vault.lock();
  store.unload();
  html.classList.remove('private');
  showLock();
}

function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      if (vault.isUnlocked()) {
        html.classList.add('private'); // oculta los datos en el selector de apps
        store.flush().catch(() => {});
        if (autoLockSeconds() === 0) lockApp();
      }
      return;
    }
    const awayMs = hiddenAt ? Date.now() - hiddenAt : 0; // sin un «oculto» previo no cuenta
    hiddenAt = 0;
    if (vault.isUnlocked()) {
      if (awayMs > 0 && awayMs >= autoLockSeconds() * 1000) {
        lockApp();
        return;
      }
      html.classList.remove('private');
      runRecurring();
    }
    checkForUpdate();
  });
  window.addEventListener('pagehide', () => {
    if (vault.isUnlocked()) store.flush().catch(() => {});
  });
}

/** Con el teclado abierto, deja hueco al final de las hojas y centra el campo activo. */
function setupKeyboard() {
  const viewport = window.visualViewport;
  if (viewport) {
    const update = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      html.style.setProperty('--kb', `${Math.round(inset)}px`);
    };
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
  }
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches('dialog.sheet input:not([type="checkbox"]):not([type="file"]), dialog.sheet select')) {
      setTimeout(() => target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
  });
}

async function boot() {
  if (window.top !== window.self) {
    fatal('No disponible', 'Por seguridad, Dinero no funciona dentro de otra página.');
    return;
  }
  if (!isCryptoAvailable() || !window.indexedDB) {
    fatal('Navegador no compatible', 'Abre Dinero desde su dirección segura (https://) en Safari o Chrome actualizados.');
    return;
  }
  initPwa();
  setupLifecycle();
  setupKeyboard();
  store.onSaveError((error) => {
    console.error(error);
    toast('No se han podido guardar los últimos cambios. Se volverá a intentar.', { kind: 'error' });
  });
  initScreens(appRoot, enterApp);
  onSession('lock', lockApp);
  onSession('reset', () => {
    closeAllSheets();
    unmountShell();
    store.unload();
    showWelcome();
  });
  try {
    if ((await vault.status()) === 'new') showWelcome();
    else await showLock();
  } catch (error) {
    console.error(error);
    fatal('No se puede abrir el almacenamiento', 'El navegador no permite guardar datos (¿modo privado?). Abre la app en una ventana normal.');
  }
}

boot();
