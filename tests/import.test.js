import { test, assert } from './runner.js';
import { sampleState } from './fixtures.js';
import * as idb from '../app/js/core/idb.js';
import * as vault from '../app/js/core/vault.js';
import * as store from '../app/js/core/store.js';
import { MIN_ITERATIONS } from '../app/js/core/crypto.js';
import { computeBalances, monthSummary } from '../app/js/core/finance.js';
import { normalizeData, ValidationError } from '../app/js/core/model.js';
import { prepareItems, extractMerchant, hashIban, maskIban, displayDate } from '../app/js/core/import/normalize.js';
import { planImport, findTransferCandidates } from '../app/js/core/import/plan.js';
import { categorize, sortRules, isTransferText, suggestRuleValue, itemFromMovement } from '../app/js/core/import/rules.js';

const IBAN_A = 'ES91 2100 0418 4502 0005 1332';
const IBAN_B = 'ES79 2100 0813 6101 2345 6789';
const NOW = 1_800_000_000_000;

function bankState() {
  const s = sampleState();
  s.categories.push(
    { id: 'catSuperX', kind: 'expense', name: 'Supermercado', icon: 'shopping-cart', color: 'teal', archived: false, order: 3 },
    { id: 'catOtherE', kind: 'expense', name: 'Otros gastos', icon: 'dots', color: 'gray', archived: false, order: 4 },
    { id: 'catIntrst', kind: 'income', name: 'Intereses', icon: 'trending-up', color: 'blue', archived: false, order: 5 },
    { id: 'catOtherI', kind: 'income', name: 'Otros ingresos', icon: 'dots', color: 'gray', archived: false, order: 6 },
  );
  s.movements = [];
  s.debts = [];
  s.budgets = [];
  return s;
}

async function setup(data = bankState()) {
  idb.useDatabase('nummo-test');
  await idb.deleteDatabase();
  idb.useDatabase('nummo-test');
  vault.setIterationsForTests(MIN_ITERATIONS);
  await vault.create('112233', store.allBuckets(data));
  store.setState(data);
}

let seq = 0;
const ids = () => `imp${String(seq++).padStart(9, '0')}`;

/** Importa apuntes brutos en una cuenta (como lo harán la importación de archivos y el banco). */
async function importRaw(raws, { accountId = 'accountAAA', kind = 'file', replacePendingFrom = null, bank = null, follow = true } = {}) {
  const { items, rejected } = await prepareItems(raws);
  const batch = ids();
  const plan = planImport(store.getState(), items, { accountId, kind, batch, newId: ids, now: NOW, replacePendingFrom });
  const result = store.applyImport(plan, { accountId, batch, balance: plan.balance, bank, followBalance: follow });
  return { ...result, plan, rejected };
}

const raw = (o) => ({ bdate: '2026-06-22', amount: -2707, text: 'tj-mercadona avda. castellon', ...o });
const snapshot = () => JSON.stringify(store.getState());

test('importar: el comercio se extrae del concepto del banco', () => {
  assert.equal(extractMerchant('tj-mercadona avda. castellon'), 'mercadona avda. castellon');
  assert.equal(extractMerchant('rcbo.basic-fit spain s.a.u (bnp)'), 'basic-fit spain s.a.u (bnp)');
  assert.equal(extractMerchant('cargo bizum - pizza'), 'Bizum');
  assert.equal(extractMerchant('bolt.eur2606182035'), 'bolt.');
  assert.equal(displayDate('2026-06-22', '2026-06-20'), '2026-06-20', 'fecha valor cercana = día de la compra');
  assert.equal(displayDate('2026-06-22', '2026-01-01'), '2026-06-22', 'fecha valor lejana no se usa');
});

test('importar: el IBAN solo se guarda enmascarado y como hash', async () => {
  assert.equal(maskIban(IBAN_A), '•••• 1332');
  const h = await hashIban(IBAN_A);
  assert.ok(/^[0-9a-f]{64}$/.test(h));
  assert.equal(await hashIban('es9121000418 45020005 1332'), h, 'mismo IBAN escrito distinto = mismo hash');
  assert.equal(await hashIban('no es un iban'), '');
});

test('importar: reimportar lo mismo (3 veces) no duplica nada', async () => {
  await setup();
  const file = [
    raw({ ext: 'apunte:545', bal: 93682 }),
    raw({ ext: 'apunte:544', bdate: '2026-06-22', vdate: '2026-06-21', amount: -1300, text: 'tj-restaurante taj mahal', bal: 96389 }),
    raw({ ext: 'apunte:536', bdate: '2026-06-20', amount: -100, text: 'tj-vendmarketspace', bal: 111553 }),
    raw({ ext: 'apunte:533', bdate: '2026-06-20', amount: -100, text: 'tj-vendmarketspace', bal: 111653 }),
  ];
  const first = await importRaw(file);
  assert.equal(first.stats.added, 4, 'dos cafés idénticos el mismo día son dos movimientos');
  const after1 = snapshot();
  const second = await importRaw(file);
  const third = await importRaw(file);
  assert.equal(second.stats.added + third.stats.added, 0);
  assert.equal(third.stats.duplicates, 4);
  assert.equal(snapshot(), after1, 'sync(); sync(); sync() = sync()');
});

test('importar: sin identificador del banco, la huella evita duplicados (también con dos iguales)', async () => {
  await setup();
  const file = [raw({}), raw({}), raw({ amount: -500, text: 'cafe' })];
  assert.equal((await importRaw(file, { kind: 'bank' })).stats.added, 3);
  const again = await importRaw([...file].reverse(), { kind: 'bank' });
  assert.equal(again.stats.added, 0);
  const plusOne = await importRaw([...file, raw({})], { kind: 'bank' });
  assert.equal(plusOne.stats.added, 1, 'un tercer apunte idéntico sí es nuevo');
});

test('importar: un pendiente que se contabiliza no se duplica y conserva la categoría elegida', async () => {
  await setup();
  await importRaw([raw({ status: 'pending' })], { kind: 'bank' });
  let [m] = store.getState().movements;
  assert.equal(m.source.status, 'pending');
  store.updateMovement(m.id, { categoryId: 'catFunXXX', source: { ...m.source, cat: 'user' } });
  const res = await importRaw([raw({ ext: 'tx-1', bdate: '2026-06-24' })], { kind: 'bank' });
  assert.equal(res.stats.confirmed, 1);
  assert.equal(store.getState().movements.length, 1);
  [m] = store.getState().movements;
  assert.equal(m.source.status, 'booked');
  assert.equal(m.source.ext, 'tx-1');
  assert.equal(m.categoryId, 'catFunXXX', 'la categoría de la persona se respeta');
});

test('importar: los pendientes que el banco ya no devuelve se quitan', async () => {
  await setup();
  await importRaw([raw({ status: 'pending', amount: -999, text: 'hotel' }), raw({ ext: 'b1' })], { kind: 'bank' });
  assert.equal(store.getState().movements.length, 2);
  const res = await importRaw([raw({ ext: 'b1' })], { kind: 'bank', replacePendingFrom: '2026-06-01' });
  assert.equal(res.stats.removedPending, 1);
  assert.equal(store.getState().movements.length, 1);
});

test('importar: un apunte ya importado por archivo no se duplica al llegar del banco', async () => {
  await setup();
  await importRaw([raw({ ext: 'apunte:545' })], { kind: 'file' });
  const res = await importRaw([raw({ ext: 'ENB-xyz', text: 'COMPRA TARJ. MERCADONA' })], { kind: 'bank' });
  assert.equal(res.stats.added, 0);
  assert.equal(store.getState().movements.length, 1);
});

test('importar: un gasto apuntado a mano se reconoce y recibe el origen del banco', async () => {
  await setup();
  const manual = store.addMovement({ type: 'expense', amount: 2707, date: '2026-06-21', accountId: 'accountAAA', categoryId: 'catFunXXX', note: 'Compra' });
  const res = await importRaw([raw({ ext: 'apunte:1' })]);
  assert.equal(res.stats.linked, 1);
  const [m] = store.getState().movements;
  assert.equal(m.id, manual.id);
  assert.equal(m.note, 'Compra', 'la nota de la persona se conserva');
  assert.equal(m.source.ext, 'apunte:1');
});

test('reglas: las de la persona ganan a las iniciales y aprenden de las correcciones', async () => {
  await setup();
  const s = store.getState();
  const [item] = (await prepareItems([raw({})])).items;
  const ctx = (rules) => ({ accountId: 'accountAAA', categories: s.categories, accounts: s.accounts, rules: sortRules(rules) });
  assert.equal(categorize(item, ctx([])).categoryId, 'catSuperX', 'regla inicial por comercio');
  assert.equal(categorize(item, ctx([])).cat, 'auto');
  const learned = { id: 'ruleLearn1', field: 'counterparty', op: 'contains', value: suggestRuleValue(item), categoryId: 'catFoodXX', origin: 'learned', active: true };
  assert.equal(learned.value, 'mercadona');
  assert.equal(categorize(item, ctx([learned])).categoryId, 'catFoodXX');
  const user = { id: 'ruleUser01', field: 'text', op: 'contains', value: 'mercadona avda', categoryId: 'catFunXXX', origin: 'user', active: true };
  assert.equal(categorize(item, ctx([learned, user])).categoryId, 'catFunXXX', 'la regla de la persona va primero');
  const [interest] = (await prepareItems([raw({ amount: 1234, text: 'ints.plazo     2096081936' })])).items;
  assert.equal(categorize(interest, ctx([])).categoryId, 'catIntrst');
  const [unknown] = (await prepareItems([raw({ text: 'xyz desconocido' })])).items;
  assert.deepEqual(categorize(unknown, ctx([])), { type: 'expense', categoryId: 'catOtherE', cat: 'none' });
  const [dia] = (await prepareItems([raw({ text: 'tj-media markt' })])).items;
  assert.ok(categorize(dia, ctx([])).categoryId !== 'catSuperX', '«dia» no coincide dentro de «media»');
});

test('reglas: retirar del cajero es una transferencia al efectivo, no un gasto', async () => {
  await setup();
  await importRaw([raw({ ext: 'c1', amount: -5000, text: 'reintegro cajero 1234' })]);
  const [m] = store.getState().movements;
  assert.equal(m.type, 'transfer');
  assert.equal(m.toAccountId, 'accountBBB');
  assert.equal(monthSummary(store.getState(), '2026-06').expense, 0);
});

test('reglas: guardar una regla y reaplicarla cambia solo lo que no eligió la persona', async () => {
  await setup();
  await importRaw([raw({ ext: 'r1' }), raw({ ext: 'r2', bdate: '2026-06-23' })]);
  const [a, b] = store.getState().movements;
  store.updateMovement(a.id, { categoryId: 'catFoodXX', source: { ...a.source, cat: 'user' } });
  store.addRule({ field: 'counterparty', op: 'contains', value: 'Mercadona', categoryId: 'catFunXXX', origin: 'learned' });
  const again = store.addRule({ field: 'counterparty', op: 'contains', value: 'mercadona', categoryId: 'catFunXXX' });
  assert.equal(store.getState().rules.length, 1, 'una regla igual se sustituye');
  assert.equal(again.origin, 'user');
  const s = store.getState();
  const changed = store.reapplyRules((m) => categorize(itemFromMovement(m), { accountId: m.accountId, categories: s.categories, accounts: s.accounts, rules: sortRules(s.rules) }));
  assert.equal(changed, 1);
  const byId = new Map(store.getState().movements.map((m) => [m.id, m]));
  assert.equal(byId.get(a.id).categoryId, 'catFoodXX');
  assert.equal(byId.get(b.id).categoryId, 'catFunXXX');
});

test('transferencias: dos cuentas propias se unen por IBAN y no cuentan como gasto ni ingreso', async () => {
  await setup();
  store.setAccountBank('accountAAA', { ibanHash: await hashIban(IBAN_A), ibanMasked: maskIban(IBAN_A) });
  store.setAccountBank('accountCCC', { ibanHash: await hashIban(IBAN_B), ibanMasked: maskIban(IBAN_B) });
  await importRaw([raw({ ext: 'a1', amount: -50000, text: 'trf. a mi ahorro', cpIban: IBAN_B })], { accountId: 'accountAAA' });
  assert.equal(monthSummary(store.getState(), '2026-06').expense, 50000, 'de momento es un gasto');
  const res = await importRaw([raw({ ext: 'b1', bdate: '2026-06-23', amount: 50000, text: 'trf. de cuenta', cpIban: IBAN_A })], { accountId: 'accountCCC' });
  assert.equal(res.stats.transfers, 1);
  const movements = store.getState().movements;
  assert.equal(movements.length, 1, 'una sola transferencia');
  assert.equal(movements[0].type, 'transfer');
  assert.equal(movements[0].accountId, 'accountAAA');
  assert.equal(movements[0].toAccountId, 'accountCCC');
  const summary = monthSummary(store.getState(), '2026-06');
  assert.equal(summary.expense + summary.income, 0);
  const again = await importRaw([raw({ ext: 'b1', bdate: '2026-06-23', amount: 50000, text: 'trf. de cuenta', cpIban: IBAN_A })], { accountId: 'accountCCC' });
  assert.equal(again.stats.added + again.stats.transfers, 0, 'reimportar la otra mitad no duplica');
});

test('transferencias: sin IBAN se proponen (no se unen solas) y se pueden unir', async () => {
  await setup();
  await importRaw([raw({ ext: 'a1', amount: -20000, text: 'traspaso a ahorro' })], { accountId: 'accountAAA' });
  await importRaw([raw({ ext: 'c1', amount: 20000, text: 'traspaso recibido' })], { accountId: 'accountCCC' });
  assert.equal(store.getState().movements.length, 2);
  const candidates = findTransferCandidates(store.getState(), { isTransferText });
  assert.equal(candidates.length, 1);
  store.mergeTransfer(candidates[0].expenseId, candidates[0].incomeId);
  const [t] = store.getState().movements;
  assert.equal(t.type, 'transfer');
  assert.ok(t.source && t.source2, 'conserva los dos apuntes de origen');
  const reimport = await importRaw([raw({ ext: 'c1', amount: 20000, text: 'traspaso recibido' })], { accountId: 'accountCCC' });
  assert.equal(reimport.stats.added, 0);
});

test('saldo: tras importar, la cuenta cuadra con el saldo del extracto', async () => {
  await setup();
  store.addMovement({ type: 'expense', amount: 1000, date: '2026-07-01', accountId: 'accountAAA', categoryId: 'catFoodXX', note: 'posterior' });
  await importRaw([
    raw({ ext: 'apunte:10', bdate: '2026-06-20', amount: -500, bal: 120000 }),
    raw({ ext: 'apunte:11', bdate: '2026-06-22', amount: -2707, bal: 117293 }),
  ]);
  const s = store.getState();
  assert.equal(computeBalances(s, '2026-06-22').get('accountAAA'), 117293);
  assert.equal(computeBalances(s).get('accountAAA'), 117293 - 1000, 'lo apuntado después sigue contando');
  assert.equal(s.accounts.find((a) => a.id === 'accountAAA').bank.bankBalance, 117293);
});

test('deshacer: la última importación se revierte por completo', async () => {
  await setup();
  store.addMovement({ type: 'expense', amount: 2707, date: '2026-06-22', accountId: 'accountAAA', categoryId: 'catFunXXX', note: '' });
  const before = snapshot();
  const res = await importRaw([raw({ ext: 'x1', bal: 5000 }), raw({ ext: 'x2', amount: -100, text: 'otro' })]);
  assert.ok(snapshot() !== before);
  assert.ok(store.canUndoImport(res.batch));
  assert.ok(store.undoImport(res.batch));
  assert.equal(snapshot(), before);
  assert.ok(!store.undoImport(res.batch), 'solo una vez');
});

test('importar: apuntes mal formados se descartan sin romper la importación', async () => {
  await setup();
  const res = await importRaw([raw({ ext: 'ok' }), { bdate: '2026-13-01', amount: -1, text: 'x' }, { bdate: '2026-06-01', amount: 0, text: 'x' }, null, { bdate: '2026-06-01', amount: 1.5 }]);
  assert.equal(res.rejected, 4);
  assert.equal(res.stats.added, 1);
});

test('importar: una importación inválida no cambia nada (todo o nada)', async () => {
  await setup();
  const before = snapshot();
  const { items } = await prepareItems([raw({ ext: 'z1' })]);
  const plan = planImport(store.getState(), items, { accountId: 'accountAAA', kind: 'file', batch: ids(), newId: ids, now: NOW });
  plan.add.push({ ...plan.add[0], id: ids(), categoryId: 'noExiste1' });
  assert.throws(() => store.applyImport(plan, { accountId: 'accountAAA' }), (e) => e instanceof ValidationError);
  assert.equal(snapshot(), before);
});

test('modelo v2: los datos de la versión 1 se leen y las referencias rotas se reparan', () => {
  const v1 = { ...sampleState(), version: 1 };
  delete v1.connections;
  delete v1.rules;
  const { data } = normalizeData(v1, { strict: true });
  assert.equal(data.version, 2);
  assert.deepEqual(data.connections, []);
  assert.deepEqual(data.rules, []);
  const bad = sampleState();
  bad.categories[1].parentId = 'catSalary'; // tipo distinto: se queda como principal
  bad.accounts[0].bank = { connectionId: 'noExiste1', ibanMasked: '•••• 1332', ibanHash: 'x' };
  const fixed = normalizeData(bad, { strict: true }).data;
  assert.ok(!('parentId' in fixed.categories[1]));
  assert.equal(fixed.accounts[0].bank.connectionId, null);
  assert.equal(fixed.accounts[0].bank.ibanHash, '', 'un hash mal formado no se guarda');
  const withRule = sampleState();
  withRule.rules = [{ id: 'ruleXXXX1', field: 'text', op: 'contains', value: 'abc', categoryId: 'noExiste1' }];
  assert.throws(() => normalizeData(withRule, { strict: true }), (e) => e instanceof ValidationError);
});
