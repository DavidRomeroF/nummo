// Iconos SVG en línea a partir de los trazados de icon-data.js (Tabler Icons, MIT).

import ICONS from './icon-data.js';
import { s } from './dom.js';

export const hasIcon = (name) => Object.hasOwn(ICONS, name);

/** Icono decorativo (aria-hidden) salvo que se indique `label`. */
export function icon(name, { size = 24, label = null, className = 'icon' } = {}) {
  const paths = ICONS[name] ?? ICONS.dots;
  return s('svg', {
    class: className,
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    focusable: 'false',
    'aria-hidden': label ? null : 'true',
    role: label ? 'img' : null,
    'aria-label': label,
  }, paths.map((d) => s('path', { d })));
}
