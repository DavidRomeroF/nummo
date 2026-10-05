// Enrutado por hash (#/ruta). Las pestañas sustituyen la entrada del historial; las subpáginas
// añaden una, para que el botón «atrás» de Android vuelva a la página anterior.

const routes = [];
const listeners = new Set();

export function addRoute(pattern, handler, tab) {
  const keys = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]);
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, '([A-Za-z0-9]{8,24})')}$`);
  routes.push({ re, keys, handler, tab });
}

export function currentPath() {
  const raw = location.hash.slice(1);
  return /^\/[\w/-]*$/.test(raw) ? raw : '/';
}

export function resolve() {
  const path = currentPath();
  for (const route of routes) {
    const match = route.re.exec(path);
    if (match) {
      return { path, handler: route.handler, tab: route.tab, params: Object.fromEntries(route.keys.map((k, i) => [k, match[i + 1]])) };
    }
  }
  return null;
}

const depth = () => (Number.isInteger(history.state?.depth) ? history.state.depth : 0);
const emit = () => listeners.forEach((fn) => fn());

/** Navega. replace: true para cambiar de pestaña sin acumular historial. */
export function navigate(path, { replace = false } = {}) {
  if (path === currentPath()) return;
  if (replace) history.replaceState({ depth: depth() }, '', `#${path}`);
  else history.pushState({ depth: depth() + 1 }, '', `#${path}`);
  emit();
}

/** Botón «atrás» de la barra superior: vuelve en el historial si venimos de dentro de la app. */
export function back(fallbackPath) {
  if (depth() > 0) history.back();
  else navigate(fallbackPath, { replace: true });
}

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener('popstate', emit);
window.addEventListener('hashchange', emit);
