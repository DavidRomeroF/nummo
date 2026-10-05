import { test, assert } from './runner.js';
import {
  deriveKey, importAesKey, encryptJSON, decryptJSON, encryptBytes, decryptBytes, randomBytes,
  toBase64, fromBase64, MIN_ITERATIONS, isCryptoAvailable,
} from '../app/js/core/crypto.js';

const FAST = MIN_ITERATIONS;

test('crypto: WebCrypto disponible en contexto seguro', () => {
  assert.ok(isCryptoAvailable());
});

test('crypto: cifrar y descifrar JSON (ida y vuelta)', async () => {
  const key = await importAesKey(randomBytes(32));
  const value = { texto: 'Nómina 💶', importe: 123456, lista: [1, 2, 3] };
  const box = await encryptJSON(key, value, 'aad:test');
  assert.equal(box.iv.length, 12);
  assert.deepEqual(await decryptJSON(key, box, 'aad:test'), value);
});

test('crypto: IV distinto en cada cifrado', async () => {
  const key = await importAesKey(randomBytes(32));
  const a = await encryptJSON(key, 'mismo', 'x');
  const b = await encryptJSON(key, 'mismo', 'x');
  assert.ok(toBase64(a.iv) !== toBase64(b.iv) && toBase64(a.ct) !== toBase64(b.ct));
});

test('crypto: AAD distinta, clave distinta o datos manipulados → error', async () => {
  const key = await importAesKey(randomBytes(32));
  const other = await importAesKey(randomBytes(32));
  const box = await encryptBytes(key, new TextEncoder().encode('secreto'), 'bloque:core');
  await assert.rejects(() => decryptBytes(key, box, 'bloque:mov-2026'), null, 'AAD distinta');
  await assert.rejects(() => decryptBytes(other, box, 'bloque:core'), null, 'clave distinta');
  const tampered = { iv: box.iv, ct: box.ct.slice() };
  tampered.ct[0] ^= 1;
  await assert.rejects(() => decryptBytes(key, tampered, 'bloque:core'), null, 'manipulado');
});

test('crypto: clave derivada de PIN', async () => {
  const salt = randomBytes(16);
  const key = await deriveKey('123456', salt, FAST);
  const box = await encryptJSON(key, 'ok', 'kek');
  assert.equal(await decryptJSON(await deriveKey('123456', salt, FAST), box, 'kek'), 'ok');
  await assert.rejects(async () => decryptJSON(await deriveKey('123457', salt, FAST), box, 'kek'), null, 'PIN distinto');
  await assert.rejects(() => deriveKey('123456', salt, 10), (e) => e instanceof RangeError, 'iteraciones demasiado bajas');
});

test('crypto: Base64 con datos grandes y entradas no válidas', () => {
  const big = new Uint8Array(200_000).map((_, i) => (i * 31 + 7) & 255); // getRandomValues admite ≤ 64 KB
  assert.deepEqual(fromBase64(toBase64(big)), big);
  assert.deepEqual(fromBase64(toBase64(new Uint8Array())), new Uint8Array());
  for (const bad of ['abc', '****', 'YQ==YQ==', 12]) assert.throws(() => fromBase64(bad), null, String(bad));
});
