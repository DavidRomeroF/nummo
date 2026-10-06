// Categorización de movimientos importados con reglas sencillas, sin IA y sin salir del dispositivo.
// Orden: reglas de la persona → reglas aprendidas (de sus correcciones) → reglas iniciales por
// comercio → categoría «Otros». Las reglas más largas (más concretas) ganan a las más cortas.
// Punto de extensión: categorize() recibe todo lo que necesita en `ctx`; un categorizador más
// listo (local u opcional) podría sustituirlo sin tocar la importación.

import { foldText } from '../text.js';
import { comparableText } from './normalize.js';

/**
 * Reglas iniciales: palabras del concepto (sin tildes, en minúsculas) → nombres posibles de la
 * categoría en Nummo. Solo se aplican si la persona tiene una categoría con ese nombre.
 * Las palabras deben aparecer completas: «dia» no coincide con «media».
 */
export const BUILTIN_RULES = [
  { words: ['mercadona', 'lidl', 'carrefour', 'consum', 'aldi', 'alcampo', 'eroski', 'hipercor', 'supercor', 'dia', 'ahorramas', 'bonpreu', 'caprabo', 'gadis', 'froiz', 'masymas', 'supermercado', 'hiper', 'charter', 'euro merca', 'alimentacion', 'fruteria', 'carniceria', 'mercado', 'condis', 'spar', 'covirán', 'coviran'], categories: ['supermercado', 'alimentacion', 'comida'] },
  { words: ['restaurante', 'pizzeria', 'mcdonalds', 'mc donalds', 'burger king', 'kfc', 'telepizza', 'dominos', 'foster', 'vips', 'goiko', 'just eat', 'glovo', 'uber eats', 'bar', 'cafeteria', 'cafe', 'kebab', 'sushi', 'taberna', 'cerveceria', 'pub', 'bocateria', 'montaditos', 'panaderia', 'pasteleria', 'comidas', 'tapas', 'heladeria', 'churreria', 'horno', 'burger', 'pizza'], categories: ['restaurantes', 'restaurante', 'comer fuera'] },
  { words: ['netflix', 'spotify', 'hbo', 'hbo max', 'disney', 'prime video', 'amazon prime', 'youtube', 'apple com bill', 'icloud', 'google one', 'dazn', 'movistar plus', 'filmin'], categories: ['suscripciones'] },
  { words: ['repsol', 'cepsa', 'galp', 'bp', 'shell', 'petronor', 'ballenoil', 'plenoil', 'plenergy', 'petroprix', 'gasolinera', 'carburante', 'estacion de servicio'], categories: ['gasolina', 'combustible'] },
  { words: ['renfe', 'metro', 'emt', 'tmb', 'alsa', 'bolt', 'uber', 'cabify', 'taxi', 'autobus', 'peaje', 'parking', 'aparcamiento', 'blablacar'], categories: ['transporte'] },
  { words: ['basic fit', 'gimnasio', 'gym', 'decathlon', 'mcfit', 'altafit', 'anytime fitness', 'piscina'], categories: ['deporte', 'gimnasio'] },
  { words: ['farmacia', 'clinica', 'hospital', 'dentista', 'optica', 'fisioterapia'], categories: ['salud'] },
  { words: ['iberdrola', 'endesa', 'naturgy', 'holaluz', 'repsol luz', 'totalenergies', 'movistar', 'vodafone', 'orange', 'yoigo', 'digi', 'pepephone', 'masmovil', 'lowi', 'aguas', 'canal de isabel', 'comunidad de propietarios', 'seguro', 'mapfre', 'mutua'], categories: ['facturas', 'casa'] },
  { words: ['ryanair', 'vueling', 'iberia', 'air europa', 'booking', 'airbnb', 'hotel', 'hostal', 'edreams'], categories: ['viajes'] },
  { words: ['amazon', 'aliexpress', 'el corte ingles', 'ikea', 'fnac', 'mediamarkt', 'media markt', 'pccomponentes', 'shein', 'temu', 'leroy merlin'], categories: ['compras'] },
  { words: ['zara', 'primark', 'pull bear', 'bershka', 'stradivarius', 'mango', 'hm', 'h m', 'springfield', 'lefties', 'kiabi'], categories: ['ropa'] },
  { words: ['cine', 'cines', 'yelmo', 'cinesa', 'kinepolis', 'bowling', 'teatro', 'entradas', 'ticketmaster', 'museo', 'ocine', 'fourvenues', 'discoteca', 'concierto'], categories: ['ocio'] },
  { words: ['autoescuela', 'academia', 'universidad', 'matricula', 'libreria'], categories: ['educacion'] },
  { words: ['nomina', 'nominas'], categories: ['nomina', 'salario'], sign: 'in' },
  { words: ['ints', 'intereses', 'interes', 'liquidacion intereses', 'rendimiento'], categories: ['intereses'], sign: 'in' },
  { words: ['devolucion', 'reembolso', 'abono compra'], categories: ['reembolsos'], sign: 'in' },
  { words: ['abono bizum', 'bizum recibido'], categories: ['reembolsos'], sign: 'in' },
];

/** Concepto de retirada o ingreso de efectivo: es dinero que cambia de cuenta, no un gasto. */
export const CASH_WORDS = ['cajero', 'reintegro', 'retirada efectivo', 'retirada de efectivo', 'disposicion efectivo', 'disp efectivo', 'ingreso efectivo', 'ingreso en efectivo'];

/** Palabras que sugieren una transferencia (para proponer emparejar dos cuentas propias). */
export const TRANSFER_WORDS = ['trf', 'transf', 'transferencia', 'traspaso', 'trasp'];

const plain = (text) => comparableText(text).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * ¿Aparece la palabra (o frase) en el texto ya preparado con plain()? Debe empezar en un límite de
 * palabra. Las palabras sueltas de 5+ letras también valen como inicio («masymast054» → «masymas»);
 * las cortas tienen que ir completas («dia» no coincide con «diario» ni con «media»).
 */
export function hasWord(prepared, word) {
  const w = plain(word);
  const text = ` ${prepared} `;
  if (text.includes(` ${w} `)) return true;
  return w.length >= 5 && !w.includes(' ') && text.includes(` ${w}`);
}

const hasAny = (prepared, words) => words.some((w) => hasWord(prepared, w));

/** ¿Cumple el movimiento la condición de una regla? */
export function ruleMatches(rule, item) {
  if (!rule.active) return false;
  if (rule.field === 'mcc') return item.mcc !== '' && item.mcc === rule.value;
  const target = rule.field === 'counterparty' ? item.cp : item.text;
  const haystack = plain(target);
  const needle = plain(rule.value);
  if (!needle) return false;
  if (rule.op === 'equals') return haystack === needle;
  if (rule.op === 'starts') return haystack.startsWith(needle);
  return haystack.includes(needle);
}

/** Categoría de reserva de un tipo: «Otros gastos»/«Otros ingresos» si existe; si no, la primera activa. */
export function fallbackCategory(categories, kind) {
  const active = categories.filter((c) => c.kind === kind && !c.archived);
  return active.find((c) => foldText(c.name).startsWith('otros')) ?? active[0] ?? null;
}

function categoryByNames(categories, kind, names) {
  // Gana el primer nombre de la lista que exista (el más preciso), entre categorías activas.
  for (const name of names) {
    const found = categories.find((c) => c.kind === kind && !c.archived && plain(c.name) === plain(name));
    if (found) return found;
  }
  return null;
}

/** Orden de aplicación de las reglas guardadas: las de la persona primero y las largas antes. */
export function sortRules(rules) {
  return [...rules].sort((a, b) => (a.origin === b.origin ? 0 : a.origin === 'user' ? -1 : 1)
    || b.value.length - a.value.length);
}

/**
 * Decide qué es un movimiento importado.
 * item: apunte preparado (normalize.js). ctx: { accountId, categories, accounts, rules (ordenadas) }.
 * Devuelve { type: 'expense'|'income', categoryId, cat } o { type: 'transfer', otherAccountId, cat }.
 */
export function categorize(item, ctx) {
  const kind = item.amount < 0 ? 'expense' : 'income';
  const categoryOk = (id) => ctx.categories.some((c) => c.id === id && c.kind === kind && !c.archived);
  const accountOk = (id) => id !== ctx.accountId && ctx.accounts.some((a) => a.id === id && !a.archived);

  for (const rule of ctx.rules) {
    if (!ruleMatches(rule, item)) continue;
    if (rule.toAccountId) {
      if (accountOk(rule.toAccountId)) return { type: 'transfer', otherAccountId: rule.toAccountId, cat: 'rule' };
    } else if (categoryOk(rule.categoryId)) {
      return { type: kind, categoryId: rule.categoryId, cat: 'rule' };
    }
  }

  const prepared = plain(`${item.text} ${item.cp}`);
  if (hasAny(prepared, CASH_WORDS)) {
    const cash = ctx.accounts.find((a) => a.type === 'cash' && !a.archived && a.id !== ctx.accountId);
    if (cash) return { type: 'transfer', otherAccountId: cash.id, cat: 'auto' };
  }
  for (const builtin of BUILTIN_RULES) {
    if (builtin.sign && builtin.sign !== (item.amount < 0 ? 'out' : 'in')) continue;
    if (!hasAny(prepared, builtin.words)) continue;
    const category = categoryByNames(ctx.categories, kind, builtin.categories);
    if (category) return { type: kind, categoryId: category.id, cat: 'auto' };
  }
  const fallback = fallbackCategory(ctx.categories, kind);
  return { type: kind, categoryId: fallback?.id ?? null, cat: 'none' };
}

/**
 * Texto que se propone para una regla aprendida a partir de un movimiento: la primera palabra
 * significativa del comercio («mercadona avda. castellon» → «mercadona»).
 */
export function suggestRuleValue(item) {
  const words = plain(item.cp || item.text).split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  return words[0] ?? plain(item.cp || item.text).slice(0, 20);
}

export const isTransferText = (text) => hasAny(plain(text), TRANSFER_WORDS);

/** Datos que usan las reglas a partir de un movimiento ya guardado (para reaplicarlas). */
export function itemFromMovement(m) {
  const src = m.source ?? m.source2 ?? {};
  return {
    text: src.text || m.note || '',
    cp: src.cp || '',
    mcc: src.mcc || '',
    amount: m.type === 'expense' ? -m.amount : m.amount,
  };
}
