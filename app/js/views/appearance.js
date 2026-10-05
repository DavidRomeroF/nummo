// Apariencia: modo claro/oscuro/automático y color de la app, con vista previa en directo.

import { h } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import { section, list, row, progress } from '../ui/components.js';
import { rerender } from '../ui/shell.js';
import {
  getAppearance, setAppearance, colorLabel, ACCENT_PRESETS, MODE_OPTIONS,
} from '../ui/theme.js';

/** Ejemplo de los elementos que cambian de color (no interactivo). */
function preview() {
  return h('div', { class: 'card theme-preview', inert: true, 'aria-hidden': 'true' },
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn primary' }, 'Principal'),
      h('button', { type: 'button', class: 'btn' }, 'Secundario')),
    h('div', { class: 'quick' },
      h('span', { class: 'chip text-only', 'aria-pressed': 'true' }, 'Seleccionado'),
      h('span', { class: 'chip text-only', 'aria-pressed': 'false' }, 'Sin seleccionar'),
      h('span', { class: 'btn-text' }, 'Enlace')),
    progress(0.62, '', 'Ejemplo de progreso'),
    h('div', { class: 'switch-row' },
      h('span', { class: 'row-main row-title' }, 'Interruptor'),
      h('input', { type: 'checkbox', class: 'toggle', checked: true, tabindex: '-1' })));
}

export function appearanceView() {
  const { mode, color } = getAppearance();
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === color);
  const label = h('p', { class: 'help', 'aria-live': 'polite' });
  const swatches = [];

  // Selector libre: el propio <input type="color"> (invisible) cubre el círculo multicolor,
  // así al tocarlo se abre directamente el selector del sistema en iPhone y Android.
  const picker = h('input', { type: 'color', value: color.toLowerCase(), 'aria-label': 'Elegir otro color' });
  const custom = h('label', { class: 'swatch-picker' }, picker, icon('plus', { size: 18 }));

  const refresh = () => {
    const now = getAppearance().color;
    const preset = ACCENT_PRESETS.some((p) => p.hex === now);
    for (const swatch of swatches) swatch.setAttribute('aria-pressed', String(swatch.dataset.hex === now));
    custom.classList.toggle('selected', !preset);
    custom.style.setProperty('--tone', now);
    label.textContent = preset ? `Color: ${colorLabel(now)}` : `Color personalizado (${now})`;
  };
  // Vista previa en directo mientras se mueve el selector; sin repintar la vista para no cerrarlo.
  picker.addEventListener('input', () => {
    setAppearance({ color: picker.value });
    refresh();
  });

  for (const preset of ACCENT_PRESETS) {
    const swatch = h('button', {
      type: 'button',
      class: 'swatch',
      style: { '--tone': preset.hex },
      dataset: { hex: preset.hex },
      'aria-label': preset.label,
      'aria-pressed': String(preset.hex === color),
      onClick: () => {
        setAppearance({ color: preset.hex });
        refresh();
      },
    });
    swatches.push(swatch);
  }
  custom.classList.toggle('selected', !isPreset);
  refresh();

  return {
    title: 'Apariencia',
    back: { label: 'Más', path: '/mas' },
    body: [
      section({ title: 'Modo' }, list(MODE_OPTIONS.map((option) => row({
        title: option.label,
        subtitle: option.help ?? null,
        trailing: option.value === mode ? icon('check', { className: 'icon check' }) : null,
        label: `${option.label}${option.value === mode ? ', seleccionado' : ''}`,
        onClick: () => {
          setAppearance({ mode: option.value });
          rerender();
        },
      })), { plain: true })),
      section({ title: 'Color', caption: 'Se usa en botones, pestañas, enlaces, selecciones, interruptores y barras. La app ajusta el tono para que siempre se lea bien, en claro y en oscuro.' },
        h('div', { class: 'card' },
          h('div', { class: 'swatches', role: 'group', 'aria-label': 'Color de la app' }, swatches, custom),
          label)),
      section({ title: 'Vista previa' }, preview()),
      h('p', { class: 'caption' }, 'El icono de la pantalla de inicio no cambia de color: iOS y Android no lo permiten en las apps web. Este ajuste se guarda solo en este dispositivo.'),
    ],
  };
}
