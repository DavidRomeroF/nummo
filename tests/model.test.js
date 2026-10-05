import { test, assert } from './runner.js';
import { sampleState } from './fixtures.js';
import {
  normalizeData, normalizeAccount, normalizeCategory, normalizeRecurring, createInitialState,
  ValidationError, SCHEMA_VERSION, allBucketKeys, buildBucket, mergeBuckets, movementBucket,
} from '../app/js/core/model.js';
import { cleanText, cleanLetters, foldText } from '../app/js/core/text.js';

const isValidation = (e) => e instanceof ValidationError;

test('model: un conjunto válido pasa la validación estricta sin cambios', () => {
  const raw = sampleState();
  const { data, dropped } = normalizeData(raw);
  assert.equal(dropped, 0);
  assert.deepEqual(data, sampleState());
});

test('model: el estado inicial es válido y trae cuentas y categorías', () => {
  const initial = createInitialState();
  const { data } = normalizeData(initial);
  assert.equal(data.accounts.length, 2);
  assert.ok(data.categories.some((c) => c.kind === 'expense') && data.categories.some((c) => c.kind === 'income'));
  assert.equal(data.version, SCHEMA_VERSION);
});

test('model: referencias rotas → error en modo estricto, descarte en modo reparación', () => {
  const raw = sampleState();
  raw.movements.push({ id: 'movBroken1', date: '2026-10-08', type: 'expense', amount: 100, accountId: 'noExiste1', categoryId: 'catFoodXX' });
  assert.throws(() => normalizeData(raw), isValidation);
  const { data, dropped } = normalizeData(raw, { strict: false });
  assert.equal(dropped, 1);
  assert.equal(data.movements.length, sampleState().movements.length);
});

test('model: reglas de coherencia de movimientos', () => {
  const base = { id: 'movTest01', date: '2026-10-08', amount: 100, note: '' };
  const cases = [
    { ...base, type: 'transfer', accountId: 'accountAAA', toAccountId: 'accountAAA' }, // misma cuenta
    { ...base, type: 'expense', accountId: 'accountAAA', categoryId: 'catSalary' }, // categoría de ingreso
    { ...base, type: 'income', accountId: 'accountAAA', categoryId: 'catFoodXX' }, // categoría de gasto
    { ...base, type: 'debt', debtId: 'noExiste1', flow: 'pay', accountId: null }, // deuda inexistente
    { ...base, type: 'debt', debtId: 'debtOweXX', flow: 'otro', accountId: null }, // operación inválida
    { ...base, type: 'expense', accountId: 'accountAAA', categoryId: 'catFoodXX', amount: 0 }, // importe 0
    { ...base, type: 'expense', accountId: 'accountAAA', categoryId: 'catFoodXX', amount: 1.5 }, // decimales
    { ...base, type: 'expense', accountId: 'accountAAA', categoryId: 'catFoodXX', date: '2026-02-30' },
    { ...base, type: 'robo', accountId: 'accountAAA' },
  ];
  for (const movement of cases) {
    const raw = sampleState();
    raw.movements.push(movement);
    assert.throws(() => normalizeData(raw), isValidation, JSON.stringify(movement));
  }
});

test('model: identificadores repetidos y presupuestos duplicados se rechazan', () => {
  const raw = sampleState();
  raw.accounts.push({ ...raw.accounts[0] });
  assert.throws(() => normalizeData(raw), isValidation);
  const raw2 = sampleState();
  raw2.budgets.push({ id: 'budgetDup', categoryId: 'catFunXXX', amount: 500 });
  assert.throws(() => normalizeData(raw2), isValidation);
  const raw3 = sampleState();
  raw3.budgets.push({ id: 'budgetInc', categoryId: 'catSalary', amount: 500 });
  assert.throws(() => normalizeData(raw3), isValidation, 'presupuesto sobre categoría de ingreso');
});

test('model: versión de datos más nueva o desconocida', () => {
  assert.throws(() => normalizeData({ ...sampleState(), version: SCHEMA_VERSION + 1 }), (e) => isValidation(e) && /más nueva/.test(e.message));
  assert.throws(() => normalizeData({ ...sampleState(), version: 'x' }), isValidation);
  assert.throws(() => normalizeData(null), isValidation);
  assert.throws(() => normalizeData([]), isValidation);
});

test('model: saneado de textos, iconos y colores desconocidos', () => {
  const account = normalizeAccount({
    id: 'accountXYZ', name: '  Mi‮ cuenta\u0000  con   espacios ', type: 'nave', icon: '<script>', color: 'url(x)', letters: 'b-b va!', initial: 0,
  });
  assert.equal(account.name, 'Mi cuenta con espacios');
  assert.equal(account.type, 'other');
  assert.equal(account.icon, 'wallet', 'icono por defecto del tipo');
  assert.equal(account.color, 'blue');
  assert.equal(account.letters, 'BBVA');
  const long = normalizeCategory({ id: 'catLongXX', kind: 'expense', name: 'x'.repeat(100) });
  assert.equal(long.name.length, 40);
  assert.throws(() => normalizeAccount({ id: 'accountXYZ', name: '   ' }), isValidation, 'nombre vacío');
  assert.throws(() => normalizeAccount({ id: 'mal id!', name: 'A' }), isValidation, 'id inválido');
  assert.equal(cleanText('👨‍👩‍👧 Familia', 40), '👨‍👩‍👧 Familia', 'los emojis compuestos se conservan');
  assert.equal(cleanLetters('ing'), 'ING');
  assert.equal(foldText('Nómina ÁÉ'), 'nomina ae');
});

test('model: reglas programadas con fechas incoherentes', () => {
  const template = { type: 'expense', amount: 100, accountId: 'accountAAA', categoryId: 'catFoodXX' };
  const ok = normalizeRecurring({ id: 'ruleOk001', frequency: 'monthly', interval: 1, startDate: '2026-01-31', template });
  assert.equal(ok.endDate, null);
  assert.equal(ok.active, true);
  assert.throws(() => normalizeRecurring({ id: 'ruleBad01', frequency: 'monthly', startDate: '2026-05-01', endDate: '2026-04-01', template }), isValidation);
  assert.throws(() => normalizeRecurring({ id: 'ruleBad02', frequency: 'daily', startDate: '2026-05-01', template }), isValidation);
  assert.throws(() => normalizeRecurring({ id: 'ruleBad03', frequency: 'weekly', interval: 0, startDate: '2026-05-01', template }), isValidation);
});

test('model: los bloques por año reconstruyen exactamente los datos', () => {
  const state = sampleState();
  state.movements.push({ id: 'mov2025xx', date: '2025-12-31', type: 'expense', amount: 300, accountId: 'accountAAA', categoryId: 'catFoodXX', note: '', ts: 9 });
  const keys = allBucketKeys(state);
  assert.deepEqual([...keys].sort(), ['core', 'mov-2025', 'mov-2026']);
  assert.equal(movementBucket('2025-12-31'), 'mov-2025');
  const buckets = new Map([...keys].map((k) => [k, JSON.parse(JSON.stringify(buildBucket(state, k)))]));
  assert.ok(!('movements' in buckets.get('core')), 'el bloque core no lleva movimientos');
  const merged = normalizeData(mergeBuckets(buckets)).data;
  const sortById = (list) => [...list].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(sortById(merged.movements), sortById(state.movements));
  assert.throws(() => mergeBuckets(new Map([['mov-2026', { movements: [] }]])), isValidation, 'sin bloque core');
});
