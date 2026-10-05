// Saneado de texto libre introducido por la persona o leído de una copia de seguridad.

// Caracteres de control, espacios de ancho cero y marcas de dirección (permiten falsear cómo se
// ve un texto). Se conservan ZWJ/ZWNJ (U+200C/U+200D) porque los emojis compuestos los necesitan.
const UNSAFE_CHARS = /[\u0000-\u001F\u007F-\u009F​‎‏‪-‮⁦-⁩﻿]/g;

/** Texto de una línea: normalizado, sin caracteres de control, espacios colapsados y recortado. */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text); // recorta por caracteres reales, sin partir emojis
  return chars.length > max ? chars.slice(0, max).join('').trim() : text;
}

/** Iniciales de una cuenta ("BBVA", "ING"): hasta 4 letras o cifras en mayúsculas. */
export function cleanLetters(value) {
  if (typeof value !== 'string') return '';
  return Array.from(value.normalize('NFC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 4).join('');
}

/** Comparación para búsquedas: sin mayúsculas ni tildes. */
export function foldText(value) {
  return String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}
