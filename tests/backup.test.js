import { test, assert } from './runner.js';
import { sampleState } from './fixtures.js';
import { createBackup, parseBackup, openBackup, toCSV, BackupPasswordError, checkPassword } from '../app/js/core/backup.js';
import { MIN_ITERATIONS } from '../app/js/core/crypto.js';
import { ValidationError } from '../app/js/core/model.js';

const FAST = { iterations: MIN_ITERATIONS, now: new Date(2026, 9, 5, 12) };
const isValidation = (e) => e instanceof ValidationError;

test('backup: crear y restaurar con la contraseña correcta', async () => {
  const { text, filename } = await createBackup(sampleState(), 'contraseña larga', FAST);
  assert.equal(filename, 'dinero-copia-2026-10-05.json');
  assert.ok(!text.includes('Hermano') && !text.includes('Nómina'), 'el archivo no contiene datos legibles');
  const { data, exportedAt } = await openBackup(parseBackup(text), 'contraseña larga');
  const expected = sampleState();
  expected.settings.lastBackupAt = FAST.now.getTime(); // la copia se guarda como «última copia»
  assert.deepEqual(data, expected);
  assert.ok(exportedAt.startsWith('2026-10-05'));
});

test('backup: contraseña incorrecta o archivo manipulado', async () => {
  const { text } = await createBackup(sampleState(), 'contraseña larga', FAST);
  await assert.rejects(() => openBackup(parseBackup(text), 'otra contraseña'), (e) => e instanceof BackupPasswordError);
  const envelope = JSON.parse(text);
  envelope.data = `${envelope.data.slice(0, 10)}${envelope.data[10] === 'A' ? 'B' : 'A'}${envelope.data.slice(11)}`;
  await assert.rejects(() => openBackup(parseBackup(JSON.stringify(envelope)), 'contraseña larga'), (e) => e instanceof BackupPasswordError);
});

test('backup: archivos que no son copias válidas', async () => {
  const { text } = await createBackup(sampleState(), 'contraseña larga', FAST);
  const env = JSON.parse(text);
  const variants = [
    'no es json', '{}', JSON.stringify({ ...env, format: 'otra-app' }), JSON.stringify({ ...env, version: 99 }),
    JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 10 } }), JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 1e9 } }),
    JSON.stringify({ ...env, cipher: { ...env.cipher, iv: 'AAAA' } }), JSON.stringify({ ...env, data: '###' }),
  ];
  for (const variant of variants) assert.throws(() => parseBackup(variant), isValidation, variant.slice(0, 40));
  assert.throws(() => checkPassword('corta'), isValidation);
  await assert.rejects(() => createBackup(sampleState(), '1234567', FAST), isValidation, 'mínimo 8 caracteres');
});

test('backup: una copia cifrada con datos incoherentes se rechaza al abrirla', async () => {
  const broken = sampleState();
  broken.movements[0].accountId = 'noExiste1';
  const { text } = await createBackup(broken, 'contraseña larga', FAST);
  await assert.rejects(() => openBackup(parseBackup(text), 'contraseña larga'), isValidation);
});

test('backup: CSV para Excel en español y sin inyección de fórmulas', () => {
  const state = sampleState();
  state.movements[0].note = '=HYPERLINK("http://malo")';
  const csv = toCSV(state);
  const lines = csv.split('\r\n');
  assert.ok(csv.startsWith('﻿'), 'BOM UTF-8');
  assert.equal(lines[0], '﻿"Fecha";"Tipo";"Importe";"Cuenta";"Cuenta destino";"Categoría";"Deuda";"Operación";"Nota"');
  assert.equal(lines[1], '2026-09-10;"Gasto";-50,00;"Banco A";"";"Comida";"";"";"\'=HYPERLINK(""http://malo"")"');
  assert.ok(lines.some((l) => l.startsWith('2026-10-03;"Deuda";300,00;"Banco A";"";"";"Hermano";"Me prestan"')));
  assert.ok(lines.some((l) => l.startsWith('2026-10-06;"Deuda";15,00;"";"";"";"Laura";"Cobro"')));
  assert.equal(lines.length, state.movements.length + 2, 'cabecera + movimientos + línea final vacía');
});
