import { test, assert } from './runner.js';
import { sampleState } from './fixtures.js';
import * as idb from '../app/js/core/idb.js';
import * as vault from '../app/js/core/vault.js';
import * as store from '../app/js/core/store.js';
import { MIN_ITERATIONS } from '../app/js/core/crypto.js';
import { computeBalances } from '../app/js/core/finance.js';
import { createBackup } from '../app/js/core/backup.js';
import { ValidationError } from '../app/js/core/model.js';
import { importPrivateKey, signAppJwt, checkPem, KeyFormatError } from '../app/js/core/bank/jwt.js';
import { createEnableBankingProvider, mapTransaction, mapBalances, decimalToCents } from '../app/js/core/bank/enablebanking.js';
import { BankError } from '../app/js/core/bank/provider.js';
import { syncConnection, syncStatus, MAX_SYNCS_PER_DAY, AUTO_SYNC_EVERY_MS } from '../app/js/core/bank/sync.js';
import * as service from '../app/js/core/bank/service.js';

const PASSWORD = 'caballo bateria grapa';
const APP_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const TODAY = '2026-10-06';
const NOW = Date.parse('2026-10-06T10:00:00Z');

let seq = 0;
const newId = () => `bnk${String(seq++).padStart(9, '0')}`;

// --- Utilidades: claves de prueba -------------------------------------------------------------

const toPem = (bytes, label) => {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `-----BEGIN ${label}-----\n${btoa(bin).match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
};

async function testKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  return { pair, pem: toPem(pkcs8, 'PRIVATE KEY'), pkcs8 };
}
let keysPromise = null;
const keys = () => (keysPromise ??= testKeys());

/** Extrae la clave PKCS#1 de dentro de una PKCS#8 (para probar el formato «RSA PRIVATE KEY»). */
function pkcs8ToPkcs1(der) {
  let p = 0;
  const readLen = () => {
    let len = der[p++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let i = 0; i < n; i += 1) len = (len << 8) | der[p++];
    }
    return len;
  };
  const skip = () => {
    const n = readLen(); // primero avanza sobre la longitud, luego sobre el contenido
    p += n;
  };
  p += 1; readLen(); // SEQUENCE
  p += 1; skip(); // INTEGER versión
  p += 1; skip(); // SEQUENCE algoritmo
  p += 1; const len = readLen(); // OCTET STRING
  return der.slice(p, p + len);
}

// --- Proveedor simulado -----------------------------------------------------------------------

function fakeProvider({ accounts = [{ externalId: 'ext-1' }], tx = { 'ext-1': [] }, balances = { 'ext-1': { booked: 100000, available: 100000, date: TODAY } }, session = { status: 'active', validUntil: NOW + 90 * 86_400_000 } } = {}) {
  const calls = [];
  const provider = {
    id: 'enablebanking',
    failOn: null, // { method, error, times }
    periodLimitDays: null,
    async getSession() {
      calls.push('session');
      this.maybeFail('session');
      return { ...session, accountIds: accounts.map((a) => a.externalId) };
    },
    async getBalances(id) {
      calls.push(`balances:${id}`);
      this.maybeFail('balances', id);
      return balances[id];
    },
    async getTransactions(id, { dateFrom, cursor }) {
      calls.push(`tx:${id}:${dateFrom}:${cursor ?? ''}`);
      this.maybeFail('tx', id);
      if (this.periodLimitDays && dateFrom < addDaysISO(TODAY, -this.periodLimitDays)) throw new BankError('period', { detail: 'WRONG_TRANSACTIONS_PERIOD' });
      const list = (tx[id] ?? []).filter((t) => t.bdate >= dateFrom);
      // Dos páginas para probar la paginación.
      const half = Math.ceil(list.length / 2);
      return cursor ? { items: list.slice(half), cursor: null } : { items: list.slice(0, half), cursor: list.length > 1 ? 'page2' : null };
    },
    async revoke() { calls.push('revoke'); },
    maybeFail(method, id) {
      const f = this.failOn;
      if (f && f.method === method && (!f.id || f.id === id) && f.times > 0) {
        f.times -= 1;
        throw f.error;
      }
    },
    calls,
    tx,
    balances,
    session,
  };
  return provider;
}
function addDaysISO(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const t = (o) => ({ ext: '', bdate: '2026-10-01', amount: -2707, text: 'COMPRA TARJ. MERCADONA', status: 'booked', bal: null, ...o });

async function setupBank({ kind = 'password' } = {}) {
  const data = sampleState();
  data.movements = [];
  data.debts = [];
  data.budgets = [];
  idb.useDatabase('nummo-test');
  await idb.deleteDatabase();
  idb.useDatabase('nummo-test');
  vault.setIterationsForTests(MIN_ITERATIONS);
  await vault.create(kind === 'password' ? PASSWORD : '112233', store.allBuckets(data), kind);
  store.setState(data);
  const connection = store.addConnection({ id: 'connAAAA01', provider: 'enablebanking', bankName: 'Caja Rural', status: 'active', validUntil: NOW + 90 * 86_400_000 });
  store.setAccountBank('accountAAA', { connectionId: connection.id, externalId: 'ext-1' });
  return connection;
}

const sync = (provider, opts = {}) => syncConnection('connAAAA01', { store, provider, sessionId: 'session-1', newId, now: NOW, today: TODAY, ...opts });
const dataOnly = () => JSON.stringify({ m: store.getState().movements, a: store.getState().accounts });

// --- JWT y clave privada ----------------------------------------------------------------------

test('banco: la clave privada se importa como no extraíble y firma un JWT válido', async () => {
  const { pair, pem } = await keys();
  const key = await importPrivateKey(pem);
  assert.equal(key.extractable, false, 'nadie puede leer la clave desde la app');
  assert.deepEqual(key.usages, ['sign']);
  await assert.rejects(() => crypto.subtle.exportKey('pkcs8', key));
  const jwt = await signAppJwt(key, APP_ID, { now: NOW });
  const [h, b, s] = jwt.split('.');
  const decode = (part) => JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
  assert.deepEqual(decode(h), { typ: 'JWT', alg: 'RS256', kid: APP_ID });
  const body = decode(b);
  assert.equal(body.iss, 'enablebanking.com');
  assert.equal(body.aud, 'api.enablebanking.com');
  assert.equal(body.exp - body.iat, 3600);
  const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, sig, new TextEncoder().encode(`${h}.${b}`));
  assert.ok(ok, 'firma verificable con la clave pública');
});

test('banco: acepta claves PKCS#1 y rechaza archivos que no son una clave', async () => {
  const { pkcs8 } = await keys();
  const key = await importPrivateKey(toPem(pkcs8ToPkcs1(pkcs8), 'RSA PRIVATE KEY'));
  assert.equal(key.extractable, false);
  for (const bad of ['', 'hola', '-----BEGIN PRIVATE KEY-----\n!!!\n-----END PRIVATE KEY-----', `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(20000)}\n-----END PRIVATE KEY-----`]) {
    await assert.rejects(() => importPrivateKey(bad), (e) => e instanceof KeyFormatError);
  }
  assert.throws(() => checkPem('-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'), (e) => e instanceof KeyFormatError);
});

// --- Traducción de la API de Enable Banking ---------------------------------------------------

test('banco: los apuntes de Enable Banking se traducen al formato común', () => {
  assert.equal(decimalToCents('27.07'), 2707);
  assert.equal(decimalToCents('-5.5'), -550);
  assert.equal(decimalToCents('1e3'), null);
  assert.equal(decimalToCents('12.345'), null);
  const debit = mapTransaction({
    transaction_id: 'T1', booking_date: '2026-10-02', value_date: '2026-10-01', transaction_amount: { amount: '27.07', currency: 'EUR' },
    credit_debit_indicator: 'DBIT', status: 'BOOK', creditor: { name: 'MERCADONA SA' }, creditor_account: { iban: 'ES9121000418450200051332' },
    remittance_information: ['COMPRA TARJ.', 'MERCADONA'], balance_after_transaction: { amount: '936.82', currency: 'EUR' }, merchant_category_code: '5411',
  });
  assert.deepEqual(debit, {
    ext: 'eb:T1', bdate: '2026-10-02', vdate: '2026-10-01', amount: -2707, currency: 'EUR', text: 'COMPRA TARJ. MERCADONA',
    cp: 'MERCADONA SA', cpIban: 'ES9121000418450200051332', status: 'booked', bal: 93682, mcc: '5411',
  });
  const credit = mapTransaction({ entry_reference: 'E9', booking_date: '2026-10-03', transaction_amount: { amount: '1200.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'PDNG', debtor: { name: 'EMPRESA' } });
  assert.equal(credit.amount, 120000);
  assert.equal(credit.status, 'pending');
  assert.equal(credit.ext, 'eb:E9');
  assert.equal(mapTransaction({ booking_date: '2026-10-03', transaction_amount: { amount: '-3.00' }, credit_debit_indicator: 'CRDT' }).amount, -300, 'un importe negativo manda sobre el indicador');
  assert.equal(mapTransaction({ booking_date: 'mal', transaction_amount: { amount: '3' } }), null);
  assert.equal(mapTransaction({ booking_date: '2026-10-03', transaction_amount: { amount: 'abc' } }), null);
  assert.deepEqual(mapBalances({ balances: [
    { balance_type: 'ITAV', balance_amount: { amount: '90.00' } },
    { balance_type: 'CLBD', balance_amount: { amount: '100.50' }, reference_date: '2026-10-05' },
  ] }), { booked: 10050, available: 9000, date: '2026-10-05' });
});

function fakeFetch(handler) {
  const log = [];
  const fn = async (url, init) => {
    log.push({ url, init });
    const { status = 200, body = {}, headers = {}, raw = null, throws = null } = await handler(url, init);
    if (throws) throw throws;
    return new Response(raw ?? JSON.stringify(body), { status, headers });
  };
  fn.log = log;
  return fn;
}

test('banco: las peticiones van firmadas, sin cookies y solo a api.enablebanking.com', async () => {
  const privateKey = await importPrivateKey((await keys()).pem);
  const fetchImpl = fakeFetch((url) => (url.includes('/transactions') && !url.includes('continuation_key')
    ? { body: { transactions: [{ transaction_id: 'A', booking_date: '2026-10-01', transaction_amount: { amount: '1.00' }, credit_debit_indicator: 'DBIT' }], continuation_key: 'k2' } }
    : { body: { transactions: [{ transaction_id: 'B', booking_date: '2026-10-02', transaction_amount: { amount: '2.00' }, credit_debit_indicator: 'DBIT' }] } }));
  const provider = createEnableBankingProvider({ appId: APP_ID, privateKey, fetchImpl, now: () => NOW });
  const page1 = await provider.getTransactions('acc/1', { dateFrom: '2026-09-01' });
  const page2 = await provider.getTransactions('acc/1', { dateFrom: '2026-09-01', cursor: page1.cursor });
  assert.deepEqual([...page1.items, ...page2.items].map((i) => i.ext), ['eb:A', 'eb:B']);
  for (const { url, init } of fetchImpl.log) {
    assert.ok(url.startsWith('https://api.enablebanking.com/accounts/acc%2F1/transactions?'), 'ruta escapada y dominio fijo');
    assert.ok(init.headers.Authorization.startsWith('Bearer '));
    assert.equal(init.credentials, 'omit');
  }
  assert.ok(fetchImpl.log[1].url.includes('continuation_key=k2'));
  assert.throws(() => createEnableBankingProvider({ appId: 'x', privateKey }), (e) => e instanceof BankError && e.code === 'app_auth');
});

test('banco: los errores de la API se traducen sin filtrar datos', async () => {
  const privateKey = await importPrivateKey((await keys()).pem);
  const cases = [
    [{ status: 429, body: { error: 'ASPSP_RATE_LIMIT_EXCEEDED' }, headers: { 'Retry-After': '120' } }, 'rate_limit'],
    [{ status: 422, body: { error: 'WRONG_TRANSACTIONS_PERIOD', message: 'IBAN ES91… saldo 936,82' } }, 'period'],
    [{ status: 401, body: { error: 'EXPIRED_SESSION' } }, 'expired'],
    [{ status: 401, body: {} }, 'app_auth'],
    [{ status: 503, body: {} }, 'unavailable'],
    [{ status: 400, body: { error: 'X<script>' } }, 'invalid'],
    [{ status: 200, raw: 'no es json' }, 'bad_response'],
    [{ throws: new TypeError('Failed to fetch') }, 'blocked'],
  ];
  for (const [response, code] of cases) {
    const provider = createEnableBankingProvider({ appId: APP_ID, privateKey, fetchImpl: fakeFetch(() => response) });
    let error = null;
    try {
      await provider.getBalances('a');
    } catch (e) {
      error = e;
    }
    assert.ok(error instanceof BankError, `${code}: debe ser BankError`);
    assert.equal(error.code, code);
    assert.ok(!/ES91|936|<script>/.test(`${error.message} ${error.detail}`), `${code}: sin datos de la respuesta`);
    if (code === 'rate_limit') assert.equal(error.retryAfterMs, 120_000);
  }
});

// --- Sincronización ---------------------------------------------------------------------------

test('sync: sync(); sync(); sync() deja lo mismo que sync()', async () => {
  await setupBank();
  const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1' }), t({ ext: 'eb:2', bdate: '2026-10-02', amount: -1300, text: 'RESTAURANTE' }), t({ ext: '', bdate: '2026-10-03', amount: 250000, text: 'NOMINA EMPRESA' })] } });
  const first = await sync(provider);
  assert.equal(first.stats.added, 3);
  const after = dataOnly();
  for (let i = 0; i < 2; i += 1) {
    const again = await sync(provider);
    assert.equal(again.stats.added ?? 0, 0);
  }
  assert.equal(dataOnly(), after);
  assert.equal(computeBalances(store.getState()).get('accountAAA'), 100000, 'el saldo cuadra con el del banco');
  const conn = store.getState().connections[0];
  assert.equal(conn.syncLog.length, 3);
  assert.ok(conn.syncLog.every((e) => e.ok));
  assert.ok(provider.calls.some((c) => c.endsWith(':page2')), 'recorre todas las páginas');
});

test('sync: solo se añaden los movimientos realmente nuevos y el saldo se actualiza', async () => {
  await setupBank();
  const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1' })] } });
  await sync(provider);
  provider.tx['ext-1'].push(t({ ext: 'eb:2', bdate: '2026-10-05', amount: -500, text: 'CAFE' }));
  provider.balances['ext-1'] = { booked: 99500, available: 99500, date: TODAY };
  const res = await sync(provider);
  assert.equal(res.stats.added, 1);
  assert.equal(store.getState().movements.length, 2);
  assert.equal(computeBalances(store.getState()).get('accountAAA'), 99500);
  assert.ok(provider.calls.some((c) => c.startsWith('tx:ext-1:2026-09-')), 'la segunda vez pide desde el último apunte menos un margen');
});

test('sync: un pendiente se confirma, cuenta en el saldo y no se duplica', async () => {
  await setupBank();
  const provider = fakeProvider({ tx: { 'ext-1': [t({ status: 'pending', bdate: '2026-10-05' })] }, balances: { 'ext-1': { booked: 100000, available: 97293, date: TODAY } } });
  await sync(provider);
  assert.equal(computeBalances(store.getState()).get('accountAAA'), 97293, 'contable + pendiente');
  provider.tx['ext-1'] = [t({ ext: 'eb:9', bdate: '2026-10-06' })];
  provider.balances['ext-1'] = { booked: 97293, available: 97293, date: TODAY };
  const res = await sync(provider);
  assert.equal(res.stats.confirmed, 1);
  assert.equal(store.getState().movements.length, 1);
  assert.equal(store.getState().movements[0].source.status, 'booked');
  assert.equal(computeBalances(store.getState()).get('accountAAA'), 97293);
});

test('sync: permiso caducado o revocado no toca los datos y marca el banco', async () => {
  for (const status of ['expired', 'revoked']) {
    await setupBank();
    const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1' })] }, session: { status, validUntil: NOW - 1 } });
    const before = dataOnly();
    await assert.rejects(() => sync(provider), (e) => e instanceof BankError && e.code === status);
    assert.equal(dataOnly(), before);
    const conn = store.getState().connections[0];
    assert.equal(conn.status, status);
    assert.equal(conn.lastError.code, status);
    assert.ok(!syncStatus(conn, NOW).canAuto);
  }
  await setupBank();
  await assert.rejects(() => sync(fakeProvider(), { sessionId: null }), (e) => e.code === 'expired');
});

test('sync: límite de consultas (429) y banco caído quedan registrados', async () => {
  await setupBank();
  const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1' })] } });
  provider.failOn = { method: 'tx', error: new BankError('rate_limit'), times: 1 };
  await assert.rejects(() => sync(provider), (e) => e.code === 'rate_limit');
  let conn = store.getState().connections[0];
  assert.equal(conn.lastError.code, 'rate_limit');
  assert.ok(!syncStatus(conn, NOW + 3_600_000).canAuto, 'no se reintenta solo antes de 6 h');
  assert.equal(store.getState().movements.length, 0);
  provider.failOn = { method: 'balances', error: new BankError('unavailable'), times: 1 };
  await assert.rejects(() => sync(provider), (e) => e.code === 'unavailable');
  conn = store.getState().connections[0];
  assert.equal(conn.status, 'active', 'un fallo temporal no desconecta el banco');
  const ok = await sync(provider);
  assert.equal(ok.stats.added, 1);
});

test('sync: si el banco no da tanto historial, se acorta el periodo', async () => {
  await setupBank();
  const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1', bdate: '2026-09-20' })] } });
  provider.periodLimitDays = 60;
  const res = await sync(provider);
  assert.equal(res.stats.added, 1);
  assert.ok(provider.calls.some((c) => c.startsWith(`tx:ext-1:${addDaysISO(TODAY, -60)}`)));
  provider.periodLimitDays = 1;
  store.getState().movements.length = 0; // fuerza una primera sincronización otra vez
  await assert.rejects(() => sync(provider), (e) => e.code === 'period');
});

test('sync: detecta cuentas nuevas del banco sin vincularlas solas', async () => {
  await setupBank();
  const provider = fakeProvider({
    accounts: [{ externalId: 'ext-1' }, { externalId: 'ext-2' }],
    tx: { 'ext-1': [], 'ext-2': [t({ ext: 'x' })] },
    balances: { 'ext-1': { booked: 100000, available: null, date: TODAY }, 'ext-2': { booked: 5, available: null, date: TODAY } },
  });
  const res = await sync(provider);
  assert.deepEqual(res.newAccounts, ['ext-2']);
  assert.equal(res.accounts, 1);
  assert.ok(!provider.calls.some((c) => c.includes('ext-2')), 'no se lee una cuenta que la persona no ha vinculado');
});

test('sync: como mucho 4 al día y una cada 6 horas de forma automática', () => {
  const base = { status: 'active', validUntil: NOW + 86_400_000, lastSyncAt: NOW - AUTO_SYNC_EVERY_MS, lastError: null, syncLog: [] };
  assert.ok(syncStatus(base, NOW).canAuto);
  assert.ok(!syncStatus({ ...base, lastSyncAt: NOW - 3_600_000 }, NOW).canAuto, 'menos de 6 h desde la última');
  const full = { ...base, syncLog: Array.from({ length: MAX_SYNCS_PER_DAY }, (_, i) => ({ at: NOW - i * 3_600_000, ok: true, code: '' })) };
  assert.ok(!syncStatus(full, NOW).canAuto);
  assert.ok(syncStatus(full, NOW).overLimit);
  assert.ok(!syncStatus({ ...base, validUntil: NOW - 1 }, NOW).usable, 'permiso caducado');
  assert.equal(syncStatus({ ...base, validUntil: NOW + 5 * 86_400_000 }, NOW).expiresInDays, 5);
  const failed = { ...base, lastSyncAt: null, syncLog: [{ at: NOW - 10 * 60_000, ok: false, code: 'unavailable' }] };
  assert.ok(!syncStatus(failed, NOW).canAuto, 'tras un fallo no reintenta enseguida');
  assert.ok(syncStatus(failed, NOW + 3_600_000).canAuto, 'sí pasada una hora');
});

// --- Secretos y seguridad ---------------------------------------------------------------------

test('seguridad: el acceso al banco exige contraseña, va cifrado y no entra en las copias', async () => {
  await setupBank({ kind: 'pin' });
  const { pem } = await keys();
  await assert.rejects(() => service.saveConfig({ appId: APP_ID, pem }), (e) => e instanceof ValidationError);
  assert.equal(store.getSecrets(), null);
  await vault.changeSecret('112233', PASSWORD, 'password');
  await assert.rejects(() => service.saveConfig({ appId: 'no-es-un-id', pem }), (e) => e instanceof ValidationError);
  await service.saveConfig({ appId: APP_ID, pem });
  assert.deepEqual(service.getConfig(), { appId: APP_ID, proxyUrl: null });
  await store.flush();
  // En disco no hay nada legible.
  const raw = JSON.stringify(await idb.entries('vault'), (k, v) => (v instanceof Uint8Array ? [...v] : v));
  assert.ok(!raw.includes('PRIVATE') && !raw.includes(APP_ID));
  // Sobrevive a bloquear y desbloquear (con la contraseña, no con el PIN).
  vault.lock();
  store.unload();
  await assert.rejects(() => vault.unlock('112233'), (e) => e instanceof vault.WrongPinError);
  vault.expireLockoutForTests();
  store.loadFromBuckets(await vault.unlock(PASSWORD));
  assert.equal(service.getConfig().appId, APP_ID);
  // Las copias de seguridad no llevan secretos y restaurar una no los borra.
  const backup = await createBackup(store.getState(), 'contraseña-copia', { iterations: MIN_ITERATIONS });
  assert.ok(!backup.text.includes('PRIVATE'));
  assert.ok(!JSON.stringify(store.getState()).includes('PRIVATE'), 'el estado de la app no contiene la clave');
  await store.replaceAll(structuredClone(store.getState()));
  assert.equal(service.getConfig().appId, APP_ID);
  // Con un banco guardado no se puede volver a un PIN.
  await assert.rejects(() => vault.changeSecret(PASSWORD, '483920', 'pin'));
});

test('seguridad: contraseñas débiles rechazadas', () => {
  assert.ok(vault.passwordProblem('corta'));
  assert.ok(vault.passwordProblem('1234567890123'));
  assert.ok(vault.passwordProblem('aaaaaaaaaaaa'));
  assert.ok(vault.passwordProblem('micontraseña1'));
  assert.equal(vault.passwordProblem(PASSWORD), '');
});

test('seguridad: la vuelta del banco solo se acepta si la inició esta app', async () => {
  await setupBank();
  await service.saveConfig({ appId: APP_ID, pem: (await keys()).pem });
  await assert.rejects(() => service.completeConnect({ code: 'abc', state: 'otro' }), (e) => e instanceof BankError && e.code === 'state');
  const secrets = store.getSecrets();
  await store.setSecrets({ ...secrets, pending: { state: 'estadoBueno123', bankName: 'Caja Rural', country: 'ES', at: Date.now() - 31 * 60_000 } });
  await assert.rejects(() => service.completeConnect({ code: 'abc', state: 'estadoBueno123' }), (e) => e.code === 'state', 'caducada');
  assert.equal(store.getSecrets().pending, undefined, 'se olvida la conexión a medias');
  await store.setSecrets({ ...store.getSecrets(), pending: { state: 'estadoBueno123', bankName: 'Caja Rural', country: 'ES', at: Date.now() } });
  await assert.rejects(() => service.completeConnect({ error: 'access_denied', state: 'estadoBueno123' }), (e) => e.code === 'denied');
});

test('seguridad: desconectar olvida la sesión y deja las cuentas como manuales', async () => {
  await setupBank();
  await service.saveConfig({ appId: APP_ID, pem: (await keys()).pem });
  await store.setSecrets({ ...store.getSecrets(), sessions: { connAAAA01: 'session-1' } });
  const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1' })] } });
  await sync(provider);
  service.setProviderForTests(provider);
  let result;
  try {
    result = await service.disconnect('connAAAA01', { deleteMovements: true });
  } finally {
    service.setProviderForTests(null);
  }
  assert.equal(result.revoked, true);
  assert.ok(provider.calls.includes('revoke'), 'se retira el permiso en el banco');
  assert.deepEqual(store.getSecrets().sessions, {});
  assert.equal(store.getState().connections.length, 0);
  const account = store.getState().accounts.find((a) => a.id === 'accountAAA');
  assert.equal(account.bank.connectionId, null);
  assert.equal(store.getState().movements.length, 0, 'se borraron los movimientos del banco');
});

test('banco: la dirección de vuelta pegada a mano se interpreta sin aceptar basura', () => {
  assert.deepEqual(service.parseReturnUrl(' https://x.github.io/nummo/?code=abc&state=st1 '), { code: 'abc', state: 'st1', error: null });
  assert.deepEqual(service.parseReturnUrl('https://x.github.io/nummo/?error=access_denied&state=st1'), { code: null, state: 'st1', error: 'access_denied' });
  assert.equal(service.parseReturnUrl('https://x.github.io/nummo/?code=abc'), null);
  assert.equal(service.parseReturnUrl('no es una url'), null);
});

test('sync: si la app se bloquea a mitad, lo descargado no se aplica', async () => {
  await setupBank();
  const provider = fakeProvider({ tx: { 'ext-1': [t({ ext: 'eb:1' })] } });
  const original = provider.getTransactions.bind(provider);
  provider.getTransactions = async (...args) => {
    const result = await original(...args);
    store.unload(); // la persona bloquea la app mientras el banco responde
    return result;
  };
  await assert.rejects(() => sync(provider));
  assert.equal(store.getState(), null);
  store.loadFromBuckets(await vault.unlock(PASSWORD));
  assert.equal(store.getState().movements.length, 0, 'nada se aplicó a la sesión nueva');
});

test('seguridad: borrar todo retira antes los permisos en el banco', async () => {
  await setupBank();
  await service.saveConfig({ appId: APP_ID, pem: (await keys()).pem });
  await store.setSecrets({ ...store.getSecrets(), sessions: { connAAAA01: 'session-1', otra00001: 'session-2' } });
  const provider = fakeProvider();
  service.setProviderForTests(provider);
  try {
    assert.equal(await service.revokeAll(), 2);
  } finally {
    service.setProviderForTests(null);
  }
  assert.equal(provider.calls.filter((c) => c === 'revoke').length, 2);
});

test('intermediario: la app puede usar un Worker propio y solo uno con forma válida', async () => {
  const privateKey = await importPrivateKey((await keys()).pem);
  const fetchImpl = fakeFetch(() => ({ body: { aspsps: [{ name: 'Caja Rural', country: 'ES' }] } }));
  const provider = createEnableBankingProvider({ appId: APP_ID, privateKey, proxyUrl: 'https://Nummo-Banco.david.workers.dev/', fetchImpl });
  await provider.listBanks('ES');
  assert.ok(fetchImpl.log[0].url.startsWith('https://nummo-banco.david.workers.dev/aspsps?'));
  for (const bad of ['http://x.y.workers.dev', 'https://evil.com', 'https://x.workers.dev.evil.com', 'https://a.b.workers.dev/ruta']) {
    assert.throws(() => createEnableBankingProvider({ appId: APP_ID, privateKey, proxyUrl: bad }), (e) => e instanceof BankError);
  }
});

test('intermediario: el Worker solo reenvía rutas de lectura y solo a tu web', async () => {
  const { default: worker } = await import('../tools/enablebanking-proxy/worker.js');
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, init });
    return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'x=1' } });
  };
  // El navegador no deja poner «Origin» en un Request: se simula la petición que recibe Cloudflare.
  const req = (url, { method = 'GET', headers = {}, body = '' } = {}) => ({ url, method, headers: new Headers(headers), text: async () => body });
  const ORIGIN = { Origin: 'https://davidromerof.github.io' };
  try {
    const ok = await worker.fetch(req('https://w.example/accounts/abc/transactions?date_from=2026-01-01', { headers: { ...ORIGIN, Authorization: 'Bearer j', Cookie: 'c=1' } }));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://davidromerof.github.io');
    assert.equal(ok.headers.get('set-cookie'), null, 'no pasa cabeceras de más');
    assert.equal(seen[0].url, 'https://api.enablebanking.com/accounts/abc/transactions?date_from=2026-01-01');
    assert.equal(seen[0].init.headers.get('authorization'), 'Bearer j');
    assert.equal(seen[0].init.headers.get('cookie'), null);
    const pre = await worker.fetch(req('https://w.example/auth', { method: 'OPTIONS', headers: ORIGIN }));
    assert.equal(pre.status, 204);
    assert.equal((await worker.fetch(req('https://w.example/aspsps', { headers: { Origin: 'https://otra-web.com' } }))).status, 403);
    assert.equal((await worker.fetch(req('https://w.example/aspsps'))).status, 403, 'sin origen, nada');
    assert.equal((await worker.fetch(req('https://w.example/payments', { method: 'POST', body: '{}', headers: ORIGIN }))).status, 404, 'nada de pagos');
    assert.equal(seen.length, 1, 'lo rechazado no llega a la API');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('banco: la búsqueda encuentra el banco aunque se escriba distinto', async () => {
  const { searchBanks } = await import('../app/js/core/bank/search.js');
  const banks = [
    { name: 'Caja Rural San José de Almassora' }, { name: 'Caja Rural de Navarra' }, { name: 'CaixaBank' },
    { name: 'Cajamar Caja Rural' }, { name: 'BBVA' },
  ];
  const names = (q) => searchBanks(banks, q).map((b) => b.name);
  assert.equal(names('caixalmassora')[0], 'Caja Rural San José de Almassora');
  assert.equal(names('Almassora')[0], 'Caja Rural San José de Almassora');
  assert.equal(names('caja rural almassora')[0], 'Caja Rural San José de Almassora');
  assert.equal(names('CAIXA RURAL ALMASSORA')[0], 'Caja Rural San José de Almassora');
  assert.deepEqual(names('bbva'), ['BBVA']);
  assert.equal(names('').length, banks.length);
  assert.deepEqual(names('zzzzzz'), []);
});
