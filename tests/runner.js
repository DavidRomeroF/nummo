// Mini ejecutor de tests sin dependencias. Los resultados se pintan en la página y quedan en
// window.__testResults y en el título ("PASS 120/120" o "FAIL 3/120") para leerlos automáticamente.

const tests = [];

export function test(name, fn) {
  tests.push({ name, fn });
}

const show = (value) => {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Map) return { __map: [...value].map(([k, v]) => [k, stable(v)]) };
  if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, stable(value[k])]));
  }
  if (value instanceof Uint8Array) return { __bytes: [...value] };
  return value;
}

export const assert = {
  ok(value, message = 'se esperaba un valor verdadero') {
    if (!value) throw new Error(message);
  },
  equal(actual, expected, message = '') {
    if (!Object.is(actual, expected)) throw new Error(`${message} → esperado ${show(expected)}, obtenido ${show(actual)}`);
  },
  deepEqual(actual, expected, message = '') {
    const a = JSON.stringify(stable(actual));
    const e = JSON.stringify(stable(expected));
    if (a !== e) throw new Error(`${message} → esperado ${e}, obtenido ${a}`);
  },
  throws(fn, check, message = 'se esperaba una excepción') {
    let error = null;
    try {
      fn();
    } catch (e) {
      error = e;
    }
    if (!error) throw new Error(message);
    if (check && !check(error)) throw new Error(`${message}: excepción inesperada ${error?.name}: ${error?.message}`);
  },
  async rejects(fn, check, message = 'se esperaba un rechazo') {
    let error = null;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    if (!error) throw new Error(message);
    if (check && !check(error)) throw new Error(`${message}: excepción inesperada ${error?.name}: ${error?.message}`);
  },
};

export async function run() {
  const list = document.getElementById('results');
  const summary = document.getElementById('summary');
  const failures = [];
  let passed = 0;
  const started = performance.now();
  for (const { name, fn } of tests) {
    const item = document.createElement('li');
    try {
      await fn();
      passed += 1;
      item.className = 'pass';
      item.textContent = `✓ ${name}`;
    } catch (error) {
      failures.push({ name, error: String(error?.stack ?? error) });
      item.className = 'fail';
      item.textContent = `✗ ${name} — ${error?.message ?? error}`;
    }
    list.append(item);
  }
  const ms = Math.round(performance.now() - started);
  const status = failures.length ? 'FAIL' : 'PASS';
  summary.textContent = `${status}: ${passed}/${tests.length} tests correctos en ${ms} ms`;
  summary.className = failures.length ? 'fail' : 'pass';
  document.title = `${status} ${passed}/${tests.length}`;
  window.__testResults = { passed, total: tests.length, failures, ms };
}
