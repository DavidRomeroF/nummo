// Construcción del DOM sin innerHTML: todo el texto entra como nodos de texto, nunca como HTML.
// Así ningún dato escrito por la persona (o leído de una copia) puede inyectar marcado o scripts.

const SVG_NS = 'http://www.w3.org/2000/svg';

function apply(el, props) {
  let value;
  for (const [key, raw] of Object.entries(props)) {
    if (raw === undefined || raw === null || raw === false) continue;
    if (key === 'value') {
      value = raw; // se asigna al final, cuando el tipo del campo ya está fijado
    } else if (key === 'class') {
      el.setAttribute('class', Array.isArray(raw) ? raw.filter(Boolean).join(' ') : raw);
    } else if (key === 'style') {
      for (const [prop, v] of Object.entries(raw)) el.style.setProperty(prop, v);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, raw);
    } else if (key.startsWith('on')) {
      if (typeof raw !== 'function') throw new TypeError(`El manejador ${key} debe ser una función`);
      el.addEventListener(key.slice(2).toLowerCase(), raw);
    } else if (key === 'text') {
      el.textContent = raw;
    } else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'selected' || key === 'open') {
      el[key] = true;
    } else {
      el.setAttribute(key, raw === true ? '' : String(raw));
    }
  }
  if (value !== undefined) el.value = value;
}

export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false || child === true) continue;
    parent.append(child instanceof Node ? child : String(child));
  }
  return parent;
}

/** Elemento HTML: h('button', { class: 'btn', onClick }, 'Guardar') */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) apply(el, props);
  return append(el, children);
}

/** Elemento SVG. */
export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (props) apply(el, props);
  return append(el, children);
}

export function replace(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Identificadores únicos para enlazar etiquetas y campos (for/id, aria-describedby). */
let counter = 0;
export const uid = (prefix = 'f') => `${prefix}${(counter += 1)}`;
