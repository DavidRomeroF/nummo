// Búsqueda tolerante de bancos por nombre: sin tildes, mayúsculas ni espacios, con «caixa» = «caja»
// y aceptando nombres comerciales pegados («caixalmassora» encuentra «Caja Rural San José de Almassora»).

import { foldText } from '../text.js';

const compact = (text) => foldText(text).replace(/caixa/g, 'caja').replace(/[^a-z0-9]+/g, '');
const words = (text) => foldText(text).replace(/caixa/g, 'caja').split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** ¿Están las letras de `needle` en orden dentro de `hay`? */
function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i += 1;
  return i === needle.length;
}

/**
 * Bancos que encajan con lo escrito, los más parecidos primero.
 * Puntuación: nombre que empieza igual → contiene el texto → contiene todas las palabras → letras en orden.
 */
export function searchBanks(banks, query) {
  const q = compact(query);
  if (!q) return [...banks];
  const qWords = words(query);
  const scored = [];
  for (const bank of banks) {
    const name = compact(bank.name);
    let score = 0;
    if (name.startsWith(q)) score = 4;
    else if (name.includes(q)) score = 3;
    else if (qWords.length && qWords.every((w) => name.includes(w))) score = 2;
    else if (q.length >= 5 && isSubsequence(q, name)) score = 1;
    if (score) scored.push({ bank, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.bank.name.localeCompare(b.bank.name, 'es')).map((s) => s.bank);
}
