// Apariencia: modo (automático, claro u oscuro) y color de acento.
// Se guarda en el dispositivo SIN cifrar porque es una preferencia visual, no un dato personal,
// y así se aplica también a la bienvenida y a la pantalla del PIN (js/theme-boot.js).

import { accentTokens, isHexColor } from '../core/color.js';

const KEY = 'dinero:apariencia';
const MODES = ['auto', 'light', 'dark'];
const TOKEN_NAMES = ['--accent', '--accent-fill', '--on-accent', '--accent-bg'];

export const DEFAULT_COLOR = '#0A64D8';
export const MODE_OPTIONS = [
  { value: 'auto', label: 'Automático', help: 'Como el sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Oscuro' },
];
export const ACCENT_PRESETS = [
  { hex: DEFAULT_COLOR, label: 'Azul' },
  { hex: '#5E5CE6', label: 'Índigo' },
  { hex: '#AF52DE', label: 'Morado' },
  { hex: '#FF2D55', label: 'Rosa' },
  { hex: '#FF3B30', label: 'Rojo' },
  { hex: '#FF9500', label: 'Naranja' },
  { hex: '#FFCC00', label: 'Amarillo' },
  { hex: '#34C759', label: 'Verde' },
  { hex: '#00A6A6', label: 'Turquesa' },
  { hex: '#48484A', label: 'Grafito' },
];

const media = matchMedia('(prefers-color-scheme: dark)');
let current = read();
let tokenCache = null;

function read() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return {
      mode: MODES.includes(saved?.mode) ? saved.mode : 'auto',
      color: isHexColor(saved?.color) ? saved.color.toUpperCase() : DEFAULT_COLOR,
    };
  } catch {
    return { mode: 'auto', color: DEFAULT_COLOR };
  }
}

/** Tokens del color actual (null = el azul por defecto, definido en css/app.css). */
function tokens() {
  if (current.color === DEFAULT_COLOR) return null;
  if (tokenCache?.color !== current.color) tokenCache = { color: current.color, value: accentTokens(current.color) };
  return tokenCache.value;
}

export const getAppearance = () => ({ ...current });
export const isDarkTheme = () => current.mode === 'dark' || (current.mode === 'auto' && media.matches);
export const colorLabel = (hex) => ACCENT_PRESETS.find((p) => p.hex === hex)?.label ?? 'Personalizado';

/** Aplica modo y color a toda la app (atributo data-theme y variables CSS de acento). */
export function applyTheme() {
  const root = document.documentElement;
  const dark = isDarkTheme();
  root.dataset.theme = dark ? 'dark' : 'light';
  const modeTokens = tokens()?.[dark ? 'dark' : 'light'];
  for (const name of TOKEN_NAMES) {
    if (modeTokens) root.style.setProperty(name, modeTokens[name]);
    else root.style.removeProperty(name);
  }
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', dark ? 'dark' : 'light');
  const fill = getComputedStyle(root).getPropertyValue('--accent-fill').trim();
  if (fill) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', fill);
}

/** Cambia la apariencia: { mode } y/o { color: '#RRGGBB' }. */
export function setAppearance(patch) {
  const next = { ...current, ...patch };
  if (!MODES.includes(next.mode) || !isHexColor(next.color)) throw new TypeError('Apariencia no válida');
  current = { mode: next.mode, color: next.color.toUpperCase() };
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...current, tokens: tokens() }));
  } catch {
    /* sin almacenamiento disponible: se aplica solo mientras la app esté abierta */
  }
  applyTheme();
}

/** Aplica el tema y sigue los cambios del sistema cuando el modo es automático. */
export function initTheme() {
  applyTheme();
  media.addEventListener('change', () => {
    if (current.mode === 'auto') applyTheme();
  });
}
