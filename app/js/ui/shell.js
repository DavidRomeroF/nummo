// Armazón de la app desbloqueada: barra superior, vista actual, barra de pestañas y botón «+».
// Cada vista es una función que devuelve { title, back?, actions?, body, fab? } a partir del estado.

import { h } from './dom.js';
import { icon } from './icons.js';
import * as router from './router.js';
import * as store from '../core/store.js';

const TABS = [
  { id: 'inicio', path: '/', label: 'Inicio', icon: 'home' },
  { id: 'movimientos', path: '/movimientos', label: 'Movimientos', icon: 'list-details' },
  { id: 'deudas', path: '/deudas', label: 'Deudas', icon: 'scale' },
  { id: 'analisis', path: '/analisis', label: 'Análisis', icon: 'chart-pie' },
  { id: 'mas', path: '/mas', label: 'Más', icon: 'dots' },
];

let root = null;
let scheduled = false;
let lastPath = null;
let unsubscribers = [];
const scrollByPath = new Map();

export function mountShell(rootEl) {
  root = rootEl;
  lastPath = null;
  unsubscribers = [store.subscribe(rerender), router.onRouteChange(rerender)];
  render();
}

export function unmountShell() {
  unsubscribers.forEach((off) => off());
  unsubscribers = [];
  scrollByPath.clear();
  root?.replaceChildren();
  root = null;
}

/** Repinta la vista actual en el siguiente fotograma (se agrupan varios cambios seguidos). */
export function rerender() {
  if (scheduled || !root) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    if (root) render();
  });
}

function topbar(view) {
  if (view.back) {
    return h('header', { class: 'topbar sub' },
      h('button', { type: 'button', class: 'btn-text back', onClick: () => router.back(view.back.path) },
        icon('chevron-left'), view.back.label),
      h('h1', { tabindex: '-1' }, view.title),
      h('div', { class: 'actions' }, view.actions ?? []));
  }
  return h('header', { class: 'topbar' },
    h('h1', { tabindex: '-1' }, view.title),
    h('div', { class: 'actions' }, view.actions ?? []));
}

function tabbar(activeTab) {
  return h('nav', { class: 'tabbar', 'aria-label': 'Secciones' }, TABS.map((tab) => h('button', {
    type: 'button',
    class: 'tab',
    'aria-current': tab.id === activeTab ? 'page' : null,
    onClick: () => {
      if (router.currentPath() === tab.path) window.scrollTo({ top: 0, behavior: 'smooth' });
      else router.navigate(tab.path, { replace: true });
    },
  }, icon(tab.icon), tab.label)));
}

function render() {
  const route = router.resolve();
  const view = route?.handler(route.params);
  if (!view) {
    router.navigate('/', { replace: true });
    return;
  }
  const samePath = route.path === lastPath;
  if (!samePath && lastPath) scrollByPath.set(lastPath, window.scrollY);
  const y = samePath ? window.scrollY : scrollByPath.get(route.path) ?? 0;
  const nodes = [topbar(view), h('main', { class: 'view', id: 'main' }, view.body)];
  nodes.push(tabbar(route.tab));
  if (view.fab) {
    nodes.push(h('button', { type: 'button', class: 'fab', 'aria-label': view.fab.label, onClick: view.fab.onClick }, icon('plus')));
  }
  root.replaceChildren(...nodes);
  root.className = 'app';
  window.scrollTo(0, y);
  if (!samePath) {
    document.title = `${view.title} · Dinero`;
    if (lastPath) root.querySelector('h1')?.focus({ preventScroll: true });
  }
  lastPath = route.path;
}
