// Arranque: comprobaciones de seguridad, PWA, ciclo de vida (bloqueo automático) y rutas.

import { h, replace } from './ui/dom.js';
import { icon } from './ui/icons.js';
import * as router from './ui/router.js';
import { mountShell, unmountShell, rerender } from './ui/shell.js';
import { closeAllSheets } from './ui/sheet.js';
import { toast, clearToasts } from './ui/toast.js';
import { initPwa, checkForUpdate, requestPersistence, onPwaChange } from './ui/pwa.js';
import { onSession, resetViews, consumeAutoLockPause, isAutoLockPaused } from './ui/session.js';
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
import { appearanceView } from './views/appearance.js';
import { initTheme } from './ui/theme.js';
import * as vault from './core/vault.js';
import * as store from './core/store.js';
import { isCryptoAvailable } from './core/crypto.js';
import { todayISO } from './core/dates.js';

const appRoot = document.getElementById('app');
const html = document.documentElement;
let hiddenAt = 0; // reloj del sistema al salir de la app
let hiddenAtMono = 0; // reloj monotónico (no se puede atrasar a mano)
let lastRecurringDay = null;
let locking = null;

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
router.addRoute('/mas/apariencia', appearanceView, 'mas');

function fatal(title, text) {
  replace(appRoot, h('div', { class: 'screen' },
    h('div', { class: 'lead' }, h('div', { class: 'app-mark', 'aria-hidden': 'true' }, icon('alert-triangle')), h('h1', null, title)),
    h('p', { class: 'text' }, text)));
}

const autoLockSeconds = () => store.getState()?.settings.autoLockSec ?? 60;

/** Crea los movimientos programados pendientes (una vez al día como mucho). */
function runRecurring() {
  const today = todayISO();
  if (today === lastRecurringDay || !store.isLoaded()) return;
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
  resetViews(); // cada sesión empieza en el mes actual, sin filtros ni búsquedas
  mountShell(appRoot);
  runRecurring();
  requestPersistence();
}

/**
 * Bloquea: guarda lo pendiente (con un reintento), cierra hojas y alertas sin animación, vacía las
 * vistas y olvida la clave. `notice` se muestra en la pantalla del PIN (y evita guardar: se usa
 * cuando los datos de esta ventana ya no son los últimos).
 */
function lockApp({ notice = null } = {}) {
  if (!vault.isUnlocked()) return locking ?? Promise.resolve();
  locking ??= (async () => {
    let warning = notice;
    if (!warning) {
      try {
        await store.flush();
      } catch {
        try {
          await store.flush();
        } catch {
          warning = 'No se han podido guardar los últimos cambios. Comprueba que el móvil tiene espacio libre.';
        }
      }
    }
    closeAllSheets({ immediate: true });
    clearToasts();
    unmountShell();
    resetViews(); // también olvida textos de búsqueda escritos
    vault.lock();
    store.unload();
    try {
      await showLock({ warning });
    } finally {
      html.classList.remove('private'); // solo cuando ya no queda nada de la sesión a la vista
    }
  })().finally(() => {
    locking = null;
  });
  return locking;
}

function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      hiddenAtMono = performance.now();
      if (vault.isUnlocked()) {
        html.classList.add('private'); // oculta los datos en el selector de apps
        store.flush().catch(() => {});
        if (autoLockSeconds() === 0 && !isAutoLockPaused()) lockApp();
      }
      return;
    }
    const wallMs = hiddenAt ? Date.now() - hiddenAt : null; // sin un «oculto» previo no cuenta
    const monoMs = hiddenAt ? performance.now() - hiddenAtMono : null;
    hiddenAt = 0;
    const paused = consumeAutoLockPause(); // vuelta de un selector de archivos o de Compartir
    if (vault.isUnlocked() && wallMs !== null && !paused) {
      // Si el reloj del sistema se atrasó no se puede saber cuánto tiempo pasó: se bloquea.
      if (wallMs < 0 || Math.max(wallMs, monoMs) >= autoLockSeconds() * 1000) {
        lockApp();
        return;
      }
    }
    if (vault.isUnlocked()) {
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
  initTheme(); // sigue los cambios del sistema en modo automático (theme-boot.js ya lo aplicó)
  if (window.top !== window.self) {
    fatal('No disponible', 'Por seguridad, Nummo no funciona dentro de otra página.');
    return;
  }
  if (!isCryptoAvailable() || !window.indexedDB) {
    fatal('Navegador no compatible', 'Abre Nummo desde su dirección segura (https://) en Safari o Chrome actualizados.');
    return;
  }
  initPwa();
  onPwaChange(rerender); // aviso de versión nueva o de instalación sin esperar a otro cambio
  setupLifecycle();
  setupKeyboard();
  store.onSaveError((error) => {
    console.error(error);
    if (error?.name === 'ConflictError') {
      // Otra ventana o pestaña de la app guardó después: estos datos ya no son los últimos.
      lockApp({ notice: 'La app se ha usado en otra ventana. Vuelve a introducir el PIN para ver los datos actualizados.' });
      return;
    }
    toast('No se han podido guardar los últimos cambios. Se volverá a intentar.', { kind: 'error' });
  });
  initScreens(appRoot, enterApp);
  onSession('lock', lockApp);
  onSession('reset', () => {
    closeAllSheets({ immediate: true });
    unmountShell();
    resetViews();
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
