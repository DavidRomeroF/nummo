// Coordinación de la sesión sin depender de main.js (evita imports circulares):
// acciones de bloqueo/reinicio, estado de las vistas por sesión y pausa del bloqueo automático.

const handlers = new Map();
const viewResets = new Set();
let autoLockPausedUntil = 0;

export function onSession(action, handler) {
  handlers.set(action, handler);
}

/** Bloquea la app ahora (guarda lo pendiente y olvida la clave). */
export const lockNow = () => handlers.get('lock')?.();

/** Vuelve a la pantalla de bienvenida tras borrar todos los datos. */
export const resetApp = () => handlers.get('reset')?.();

/**
 * Las vistas registran cómo volver a su estado inicial (mes actual, sin filtros ni búsqueda…).
 * Se llama al empezar y al terminar cada sesión y al sustituir los datos (restaurar una copia).
 */
export function registerViewReset(reset) {
  viewResets.add(reset);
}

export function resetViews() {
  viewResets.forEach((reset) => reset());
}

/**
 * Pausa el bloqueo automático mientras la persona está en una pantalla del sistema que abre la
 * propia app (selector de archivos, menú Compartir). Máximo 5 minutos.
 */
export function pauseAutoLock(ms = 5 * 60_000) {
  autoLockPausedUntil = Date.now() + ms;
  return () => {
    autoLockPausedUntil = 0;
  };
}

/** Devuelve si el bloqueo está en pausa y consume la pausa (vale para una sola vuelta a la app). */
export function consumeAutoLockPause() {
  const paused = Date.now() < autoLockPausedUntil;
  autoLockPausedUntil = 0;
  return paused;
}

export const isAutoLockPaused = () => Date.now() < autoLockPausedUntil;
