// Integración PWA: service worker (sin conexión y actualizaciones) e instalación.

let registration = null;
let waitingWorker = null;
let installPrompt = null;
let updateRequested = false;
const listeners = new Set();
// Sobre una copia: un oyente que se vuelve a suscribir al recibir el aviso no se llama en bucle.
const emit = () => [...listeners].forEach((fn) => fn());

export const pwa = {
  get updateReady() {
    return waitingWorker !== null;
  },
  /** Chrome/Android ofrece su propio diálogo de instalación. */
  get canPromptInstall() {
    return installPrompt !== null;
  },
  get isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  },
  get isIOS() {
    const ua = navigator.userAgent;
    if (/Android/i.test(ua)) return false;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },
};

export function onPwaChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function watch(reg) {
  registration = reg;
  const offer = (worker) => {
    waitingWorker = worker;
    emit();
  };
  if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offer(worker);
    });
  });
  // Solo se recarga cuando la persona pulsó «Actualizar». La primera instalación también cambia
  // de controlador (clients.claim) y recargar ahí haría perder lo que se esté escribiendo.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    location.reload();
  });
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    emit();
  });
  if (!('serviceWorker' in navigator)) return;
  if (new URLSearchParams(location.search).has('nosw')) {
    // Modo desarrollo: sin caché del service worker.
    navigator.serviceWorker.getRegistrations().then((list) => list.forEach((r) => r.unregister()));
    return;
  }
  // Trusted Types: la única URL de script que se acepta es la del propio service worker.
  const policy = window.trustedTypes?.createPolicy('app-sw', {
    createScriptURL: (url) => {
      if (url !== './sw.js') throw new TypeError('URL de service worker no permitida');
      return url;
    },
  });
  navigator.serviceWorker
    .register(policy ? policy.createScriptURL('./sw.js') : './sw.js', { scope: './' })
    .then(watch)
    .catch((error) => console.error('Service worker no registrado:', error?.name));
}

export function checkForUpdate() {
  registration?.update().catch(() => {});
}

/** Activa la versión nueva (la página se recarga sola al cambiar de controlador). */
export function applyUpdate() {
  updateRequested = true;
  waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
}

export async function promptInstall() {
  if (!installPrompt) return false;
  const prompt = installPrompt;
  installPrompt = null;
  prompt.prompt();
  const choice = await prompt.userChoice.catch(() => null);
  emit();
  return choice?.outcome === 'accepted';
}

/** Pide al navegador que no borre los datos por falta de espacio. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) await navigator.storage.persist?.();
  } catch {
    /* no disponible: no es crítico */
  }
}
