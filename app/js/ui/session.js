// Acciones de sesión que las vistas pueden pedir sin depender de main.js (evita imports circulares).

const handlers = new Map();

export function onSession(action, handler) {
  handlers.set(action, handler);
}

/** Bloquea la app ahora (guarda lo pendiente y olvida la clave). */
export const lockNow = () => handlers.get('lock')?.();

/** Vuelve a la pantalla de bienvenida tras borrar todos los datos. */
export const resetApp = () => handlers.get('reset')?.();
