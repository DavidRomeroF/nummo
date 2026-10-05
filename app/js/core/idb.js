// Envoltorio mínimo de IndexedDB con promesas.
// Dos almacenes clave-valor: 'meta' (parámetros de cifrado, intentos de PIN) y 'vault' (bloques cifrados).

const DB_VERSION = 1;
const STORES = ['meta', 'vault'];
let dbName = 'app-dinero';
let dbPromise = null;

/** Solo para tests: usar otra base de datos. */
export function useDatabase(name) {
  dbName = name;
  dbPromise = null;
}

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        for (const store of STORES) {
          if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

/** Otra instancia de la app (otra pestaña o ventana) ha escrito datos más recientes. */
export class ConflictError extends Error {
  constructor() {
    super('Los datos han cambiado en otra ventana');
    this.name = 'ConflictError';
  }
}

// Errores tras los que basta con reabrir la conexión (iOS la cierra a veces en segundo plano).
const RETRYABLE = new Set(['InvalidStateError', 'UnknownError']);

/**
 * Ejecuta `fn(tx)` en una transacción. `fn` lanza las peticiones de forma síncrona y puede
 * devolver una función que lee el resultado cuando la transacción se ha completado.
 * Las transacciones son atómicas, así que reintentar una vez tras perder la conexión es seguro.
 */
async function run(storeNames, mode, fn) {
  for (let attempt = 0; ; attempt += 1) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const options = mode === 'readwrite' ? { durability: 'strict' } : undefined;
        const tx = db.transaction(storeNames, mode, options);
        const read = fn(tx);
        tx.oncomplete = () => resolve(typeof read === 'function' ? read() : undefined);
        // El error de la petición llega antes de que tx.error tenga valor: se toma del evento.
        tx.onerror = (event) => reject(event.target?.error ?? tx.error ?? new Error('Error de IndexedDB'));
        tx.onabort = () => reject(tx.conflict ? new ConflictError() : tx.error ?? new Error('Transacción abortada'));
      });
    } catch (error) {
      if (attempt === 0 && RETRYABLE.has(error?.name)) {
        dbPromise?.then((db) => db.close()).catch(() => {});
        dbPromise = null;
        continue;
      }
      throw error;
    }
  }
}

/** Lee y reescribe un valor en una sola transacción (sin carreras entre lectura y escritura). */
export function update(store, key, change) {
  return run([store], 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    let value;
    const request = os.get(key);
    request.onsuccess = () => {
      value = change(request.result);
      os.put(value, key);
    };
    return () => value;
  });
}

/**
 * Escribe en 'vault' solo si la marca de revisión de 'meta' sigue siendo `expected` (nadie más ha
 * escrito desde que se cargaron los datos) y la sustituye por `next`. Si no, ConflictError.
 * Con `clear` vacía antes el almacén (restaurar una copia).
 */
export function writeChecked({ expected, next, puts = [], deletes = [], clear = false }) {
  return run(['meta', 'vault'], 'readwrite', (tx) => {
    const meta = tx.objectStore('meta');
    const vault = tx.objectStore('vault');
    const request = meta.get('revision');
    request.onsuccess = () => {
      if (request.result !== expected) {
        tx.conflict = true;
        tx.abort();
        return;
      }
      if (clear) vault.clear();
      for (const [key, value] of puts) vault.put(value, key);
      for (const key of deletes) vault.delete(key);
      meta.put(next, 'revision');
    };
  });
}

export function get(store, key) {
  return run([store], 'readonly', (tx) => {
    const request = tx.objectStore(store).get(key);
    return () => request.result;
  });
}

/** Todas las parejas [clave, valor] de un almacén. */
export function entries(store) {
  return run([store], 'readonly', (tx) => {
    const os = tx.objectStore(store);
    const keys = os.getAllKeys();
    const values = os.getAll();
    return () => keys.result.map((key, i) => [key, values.result[i]]);
  });
}

export function put(store, key, value) {
  return run([store], 'readwrite', (tx) => {
    tx.objectStore(store).put(value, key);
  });
}

/** Escrituras y borrados en una única transacción (todo o nada). */
export function write(store, puts = [], deletes = []) {
  return run([store], 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    for (const [key, value] of puts) os.put(value, key);
    for (const key of deletes) os.delete(key);
  });
}

/** Sustituye por completo el contenido de varios almacenes en una única transacción. */
export function replaceAll(contents) {
  const names = Object.keys(contents);
  return run(names, 'readwrite', (tx) => {
    for (const name of names) {
      const os = tx.objectStore(name);
      os.clear();
      for (const [key, value] of contents[name]) os.put(value, key);
    }
  });
}

export function clearAll() {
  return replaceAll(Object.fromEntries(STORES.map((s) => [s, []])));
}

/** Solo para tests. */
export async function deleteDatabase() {
  const db = await dbPromise?.catch(() => null);
  db?.close();
  dbPromise = null;
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}
