// Color del tema: a partir del color elegido calcula, para modo claro y oscuro, los tonos que
// garantizan la legibilidad (contraste WCAG). Ajusta la luminosidad en OKLCH para conservar el
// matiz y la viveza del color (aclarar mezclando con blanco lo volvería pastel).
//
// Las superficies de referencia deben coincidir con los tokens de css/app.css (--bg y --bg-elev).

export const SURFACES = {
  light: { page: '#F2F2F7', card: '#FFFFFF' },
  dark: { page: '#000000', card: '#1C1C1E' },
};
export const TEXT_ON_LIGHT = '#111114'; // texto oscuro sobre colores claros
const WHITE = '#FFFFFF';
const MIN_TEXT = 4.5; // WCAG AA para texto normal
const HEX_RE = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value) => typeof value === 'string' && HEX_RE.test(value);

export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}

export function rgbToHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** Luminancia relativa WCAG (0 = negro, 1 = blanco). */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG entre dos colores (1 a 21). */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// --- OKLab / OKLCH (Björn Ottosson) ----------------------------------------------------------

export function toOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) };
}

function oklchToLinear({ L, C, h }) {
  const A = C * Math.cos(h);
  const B = C * Math.sin(h);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** Convierte a hexadecimal reduciendo el croma lo justo si el color no cabe en sRGB. */
export function fromOklch({ L, C, h }) {
  let lo = 0;
  let hi = C;
  if (!inGamut(oklchToLinear({ L, C, h }))) {
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ L, C: mid, h }))) lo = mid;
      else hi = mid;
    }
    C = lo;
  }
  return rgbToHex(oklchToLinear({ L, C, h }).map(toGamma));
}

/**
 * Aclara (direction = +1) u oscurece (-1) el color en pasos de luminosidad OKLCH hasta que
 * `ok(color)` se cumple. Si no llega, devuelve el extremo (blanco o negro con el mismo matiz).
 */
export function shiftUntil(hex, direction, ok) {
  if (ok(hex)) return hex;
  const { L, C, h } = toOklch(hex);
  for (let step = 1; step <= 100; step += 1) {
    const nextL = Math.min(1, Math.max(0, L + direction * step * 0.01));
    const candidate = fromOklch({ L: nextL, C, h });
    if (ok(candidate) || nextL === 0 || nextL === 1) return candidate;
  }
  return hex;
}

/** Color de relleno de botones y su texto, para un modo concreto. */
function fill(base, mode) {
  const { card } = SURFACES[mode];
  // Que el botón se distinga de la tarjeta sobre la que está.
  const minSurface = mode === 'light' ? 1.6 : 2;
  let color = shiftUntil(base, mode === 'light' ? -1 : 1, (c) => contrast(c, card) >= minSurface);
  // Colores medios u oscuros: texto blanco (oscureciendo lo justo). Colores claros: texto oscuro.
  if (contrast(WHITE, color) >= 3) {
    color = shiftUntil(color, -1, (c) => contrast(WHITE, c) >= MIN_TEXT);
    return { color, on: WHITE };
  }
  return { color, on: TEXT_ON_LIGHT };
}

/**
 * Tokens CSS del color de acento para cada modo:
 * --accent (texto, iconos y bordes), --accent-fill (botones), --on-accent (texto sobre botones),
 * --accent-bg (tinte suave para selecciones y avisos, con transparencia).
 */
export function accentTokens(base) {
  if (!isHexColor(base)) throw new TypeError('Color no válido');
  const tokens = {};
  for (const mode of ['light', 'dark']) {
    const { page, card } = SURFACES[mode];
    // El texto de color aparece sobre la página y sobre tarjetas: debe leerse en ambas.
    const text = shiftUntil(base.toUpperCase(), mode === 'light' ? -1 : 1, (c) => contrast(c, page) >= MIN_TEXT && contrast(c, card) >= MIN_TEXT);
    const button = fill(base.toUpperCase(), mode);
    tokens[mode] = {
      '--accent': text,
      '--accent-fill': button.color,
      '--on-accent': button.on,
      '--accent-bg': mode === 'light' ? `${button.color}24` : `${text}29`,
    };
  }
  return tokens;
}
