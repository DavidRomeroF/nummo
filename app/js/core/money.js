// Importes en céntimos enteros: nunca se usa coma flotante para guardar ni sumar dinero.

export const MAX_CENTS = 99_999_999_999; // 999.999.999,99 €

const fmtCurrency = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmtSigned = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', signDisplay: 'exceptZero' });
const fmtCompact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

export function isCents(value, { min = -MAX_CENTS, max = MAX_CENTS } = {}) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

/**
 * Convierte un importe escrito por la persona en céntimos.
 * Acepta "12", "12,5", "12.50", "1.234,56", "1,234.56", "1 234,56 €".
 * Devuelve null si el texto no es un importe válido (más de 2 decimales, grupos mal formados…).
 */
export function parseAmount(input, { allowNegative = false } = {}) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let s = String(input).trim().replace(/[\s  €]/g, '');
  let negative = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s)) return null;

  const separators = s.replace(/\d/g, '');
  let intPart = s;
  let decPart = '';
  if (separators.length > 0) {
    const last = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
    const sep = s[last];
    const head = s.slice(0, last);
    const tail = s.slice(last + 1);
    if (new Set(separators).size === 2) {
      // El último separador es el decimal y el otro agrupa miles: "1.234,56" o "1,234.56".
      const group = sep === ',' ? '.' : ',';
      if (!/^\d{1,2}$/.test(tail)) return null;
      if (!new RegExp(`^\\d{1,3}(\\${group}\\d{3})*$`).test(head)) return null;
      intPart = head.split(group).join('');
      decPart = tail;
    } else if (separators.length > 1) {
      // El mismo separador repetido solo puede agrupar miles: "1.234.567".
      if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})+$`).test(s)) return null;
      intPart = s.split(sep).join('');
    } else if (/^\d{1,2}$/.test(tail)) {
      intPart = head; // "12,5", "12.50", ",50"
      decPart = tail;
    } else if (/^\d{3}$/.test(tail) && /^[1-9]\d{0,2}$/.test(head)) {
      intPart = head + tail; // "1.234" → 1234 €
    } else {
      return null;
    }
  }
  if (intPart === '') intPart = '0';
  intPart = intPart.replace(/^0+(?=\d)/, '');
  if (!/^\d{1,9}$/.test(intPart)) return null;

  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  if (cents === 0) return 0;
  if (negative && !allowNegative) return null;
  const value = negative ? -cents : cents;
  return isCents(value) ? value : null;
}

/** "1.234,56 €" */
export function formatMoney(cents) {
  return fmtCurrency.format(cents / 100);
}

/** "+1.234,56 €" / "-12,00 €" / "0,00 €" */
export function formatSigned(cents) {
  return fmtSigned.format(cents / 100);
}

/** "1,2 mil" (ejes de gráficas) */
export function formatCompact(cents) {
  return fmtCompact.format(cents / 100);
}

/** Texto editable sin separador de miles: "1234,56" */
export function centsToInput(cents) {
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `-${text}` : text;
}
