// Recolocar el foco tras repintar o cerrar una hoja: quien usa teclado o VoiceOver no vuelve
// al principio de la página cada vez que cambia algo.

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

/** Identifica un elemento por su tipo y su texto visible (o su etiqueta accesible si no tiene). */
export function focusKey(el) {
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 80);
  return `${el.tagName}|${text || el.getAttribute('aria-label') || ''}`;
}

/** Enfoca el elemento equivalente dentro de `root`. Devuelve si lo encontró. */
export function restoreFocus(root, key) {
  if (!key || !root) return false;
  const match = [...root.querySelectorAll(FOCUSABLE)].find((el) => focusKey(el) === key);
  match?.focus({ preventScroll: true });
  return Boolean(match);
}
