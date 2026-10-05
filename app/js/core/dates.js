// Fechas de calendario locales como texto 'AAAA-MM-DD' y meses como 'AAAA-MM'.
// Sin horas ni zonas horarias: así un gasto del día 31 nunca "salta" al mes siguiente.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const MIN_YEAR = 1970;
export const MAX_YEAR = 2200;

export const pad2 = (n) => String(n).padStart(2, '0');

/** Días del mes (m: 1..12). */
export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toISO(y, m, d) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

export function parseISO(iso) {
  const match = typeof iso === 'string' ? ISO_RE.exec(iso) : null;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < MIN_YEAR || y > MAX_YEAR || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

export const isISODate = (value) => parseISO(value) !== null;

export function isMonthKey(value) {
  const match = typeof value === 'string' ? MONTH_RE.exec(value) : null;
  return !!match && Number(match[1]) >= MIN_YEAR && Number(match[1]) <= MAX_YEAR;
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

function fromUTCDate(date) {
  return toISO(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  return fromUTCDate(new Date(Date.UTC(y, m - 1, d + n)));
}

/**
 * Suma meses conservando el día de anclaje: 31-ene + 1 mes = 28/29-feb; con anchorDay 31,
 * 28-feb + 1 mes = 31-mar (evita que una cuota del día 31 se "encoja" para siempre).
 */
export function addMonths(iso, n, anchorDay) {
  const { y, m, d } = parseISO(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return toISO(ny, nm, Math.min(anchorDay ?? d, daysInMonth(ny, nm)));
}

export function addYears(iso, n) {
  return addMonths(iso, n * 12);
}

/** Diferencia en días (b - a). */
export function diffDays(a, b) {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

export const monthKey = (iso) => iso.slice(0, 7);

export function currentMonthKey(now = new Date()) {
  return monthKey(todayISO(now));
}

export function addMonthKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  return `${ny}-${pad2(total - ny * 12 + 1)}`;
}

/** Primer y último día del mes 'AAAA-MM'. */
export function monthBounds(key) {
  const [y, m] = key.split('-').map(Number);
  return { start: toISO(y, m, 1), end: toISO(y, m, daysInMonth(y, m)) };
}

/** Objeto Date a mediodía local (para formatear con Intl sin sorpresas de horario de verano). */
export function toLocalDate(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(y, m - 1, d, 12);
}
