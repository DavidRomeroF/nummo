// Acerca de: versión, privacidad, almacenamiento, instalación y licencias.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section } from '../ui/components.js';
import { pwa } from '../ui/pwa.js';

export const APP_VERSION = '1.0.0';

function storageInfo() {
  const text = h('span', null, 'Calculando…');
  (async () => {
    try {
      const [estimate, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
      const used = estimate?.usage ? `${(estimate.usage / 1024 / 1024).toFixed(1).replace('.', ',')} MB usados` : 'Uso no disponible';
      text.textContent = `${used}. ${persisted ? 'El navegador conservará los datos aunque falte espacio.' : 'El navegador podría borrar los datos si le falta espacio: instala la app y haz copias.'}`;
    } catch {
      text.textContent = 'Información no disponible en este navegador.';
    }
  })();
  return text;
}

export function aboutView() {
  return {
    title: 'Acerca de',
    back: { label: 'Más', path: '/mas' },
    body: [
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('div', null, h('p', { class: 'section-title' }, 'Dinero'), h('p', { class: 'muted' }, `Versión ${APP_VERSION}`)),
          h('div', { class: 'app-mark', 'aria-hidden': 'true' }, icon('wallet')))),
      section({ title: 'Privacidad' }, h('div', { class: 'card' },
        h('p', null, 'Dinero no tiene servidores, no usa cookies ni analítica y no envía tus datos a ningún sitio. Todo se guarda cifrado solo en este dispositivo.'),
        h('p', { class: 'muted' }, 'La web desde la que se descarga la app (GitHub Pages) puede registrar visitas técnicas, como cualquier web, pero nunca recibe tus datos.'))),
      section({ title: 'Almacenamiento' }, h('div', { class: 'card' }, storageInfo())),
      section({ title: 'Instalar en el móvil' }, h('div', { class: 'card' },
        h('p', null, h('strong', null, 'iPhone: '), 'abre la web en Safari, pulsa Compartir y elige «Añadir a pantalla de inicio».'),
        h('p', null, h('strong', null, 'Android: '), 'abre la web en Chrome, menú ⋮ y «Instalar aplicación».'),
        h('p', { class: 'muted' }, pwa.isStandalone ? 'Ahora mismo la estás usando como app instalada.' : 'Ahora mismo la estás usando en el navegador.'))),
      section({ title: 'Licencias' }, h('div', { class: 'card' },
        h('p', null, 'Iconos: Tabler Icons, © 2020-2026 Paweł Kuna, licencia MIT.'),
        h('a', { href: 'https://tabler.io/icons', target: '_blank', rel: 'noopener noreferrer' }, 'tabler.io/icons'))),
    ],
  };
}
