import { test, assert } from './runner.js';
import { readStatementFile, readCsv, decodeXml } from '../app/js/core/import/files.js';
import { detectLayout, tableToRaws, parseCellDate, parseCellAmount } from '../app/js/core/import/statement.js';
import { ImportError } from '../app/js/core/import/normalize.js';

const enc = new TextEncoder();
const isImport = (code) => (e) => e instanceof ImportError && (!code || e.code === code);

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** ZIP mínimo (sin CRC, que el lector no necesita) con entradas guardadas o comprimidas. */
async function makeZip(files, { deflate = false, fakeSize = null } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const data = deflate ? await deflateRaw(raw) : raw;
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(8, deflate ? 8 : 0, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, fakeSize ?? raw.length, true);
    dv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, fakeSize ?? raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Extracto con la misma forma que el de Ruralvía, con datos inventados.
const SHEET = `<?xml version="1.0" encoding="UTF-8"?><worksheet><sheetData>
<row r="1"><c r="A1" t="str"><v>Nombre</v></c><c r="B1" t="str"><v>Persona de Prueba</v></c></row>
<row r="2"><c r="A2" t="str"><v>IBAN</v></c><c r="B2" t="str"><v>ES91 2100 0418 4502 0005 1332</v></c></row>
<row r="4"><c r="A4" t="str"><v>Fecha de la operación</v></c><c r="B4" t="str"><v>Fecha valor</v></c><c r="C4" t="str"><v>Tipo movimiento</v></c><c r="D4" t="str"><v>Importe</v></c><c r="E4" t="str"><v>Saldo</v></c><c r="F4" t="str"><v>Nro. Apunte</v></c></row>
<row r="5"><c r="A5" s="1"><v>46195.082824074074</v></c><c r="B5" s="1"><v>46194.082824074074</v></c><c r="C5" t="str"><v>tj-supermercado ejemplo &amp; cia</v></c><c r="D5" s="2"><v>-27.07</v></c><c r="E5" s="2"><v>936.82</v></c><c r="F5"><v>12</v></c></row>
<row r="6"><c r="A6" s="1"><v>46194.5</v></c><c r="B6" s="1"><v>46194.5</v></c><c r="C6" t="s"><v>0</v></c><c r="D6" s="2"><v>1200</v></c><c r="E6" s="2"><v>963.89</v></c><c r="F6"><v>11</v></c></row>
<row r="7"><c r="A7" t="str"><v>no es fecha</v></c><c r="C7" t="str"><v>basura</v></c><c r="D7"><v>5</v></c></row>
</sheetData></worksheet>`;
const XLSX_FILES = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="movimientos" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><r><t>trf. </t></r><r><t xml:space="preserve">nómina empresa</t></r></si></sst>',
  'xl/worksheets/sheet1.xml': SHEET,
};

test('archivos: Excel tipo Ruralvía (comprimido y sin comprimir)', async () => {
  for (const deflate of [false, true]) {
    const table = await readStatementFile(await makeZip(XLSX_FILES, { deflate }));
    const layout = detectLayout(table.rows);
    assert.equal(layout.template?.id, 'ruralvia');
    assert.equal(layout.iban, 'ES9121000418450200051332');
    const { raws, rejected } = tableToRaws(table.rows, layout, table);
    assert.equal(rejected, 1, 'la fila basura se descarta');
    assert.equal(raws.length, 2);
    assert.deepEqual(raws[0], { ext: 'apunte:12', bdate: '2026-06-22', vdate: '2026-06-21', amount: -2707, text: 'tj-supermercado ejemplo & cia', status: 'booked', bal: 93682 });
    assert.equal(raws[1].text, 'trf. nómina empresa', 'cadenas compartidas con formato');
    assert.equal(raws[1].amount, 120000);
  }
});

test('archivos: CSV de banco español (punto y coma, coma decimal, Windows-1252)', async () => {
  const csv = 'Fecha;Concepto;Importe;Saldo\r\n22/06/2026;"Compra; con ""comillas""";-1.234,56;10.000,00\r\n21/06/26;Café;3,5;11.234,56\r\n';
  const latin1 = new Uint8Array([...csv].map((ch) => (ch === 'é' ? 0xe9 : ch.charCodeAt(0))));
  const table = await readStatementFile(latin1);
  const layout = detectLayout(table.rows);
  const { raws } = tableToRaws(table.rows, layout, table);
  assert.equal(raws.length, 2);
  assert.equal(raws[0].text, 'Compra; con "comillas"');
  assert.equal(raws[0].amount, -123456);
  assert.equal(raws[0].bal, 1000000);
  assert.equal(raws[1].text, 'Café');
  assert.equal(raws[1].bdate, '2026-06-21');
  assert.equal(raws[1].amount, 350);
});

test('archivos: columnas de cargo y abono separadas', async () => {
  const table = readCsv(enc.encode('Fecha,Descripción,Cargo,Abono\n2026-01-05,Luz,45.20,\n2026-01-06,Devolución,,10.00\n'));
  const { raws } = tableToRaws(table.rows, detectLayout(table.rows), table);
  assert.deepEqual(raws.map((r) => r.amount), [-4520, 1000]);
});

test('archivos: fechas e importes en los formatos habituales', () => {
  assert.equal(parseCellDate(46195.99), '2026-06-22');
  assert.equal(parseCellDate('22-jun-26'), '2026-06-22');
  assert.equal(parseCellDate('2026-06-22T10:00:00'), '2026-06-22');
  assert.equal(parseCellDate('31/02/2026'), null);
  assert.equal(parseCellAmount('12,00-'), -1200);
  assert.equal(parseCellAmount('(5,10)'), -510);
  assert.equal(parseCellAmount('+1.000,00 €'), 100000);
  assert.equal(parseCellAmount(-0.1 - 0.2), -30, 'sin errores de coma flotante');
  assert.equal(parseCellAmount('abc'), null);
  assert.equal(decodeXml('&lt;a&gt; &#233; &#x1F600;'), '<a> é 😀');
});

test('archivos: rechaza archivos dañados, sin columnas o demasiado grandes', async () => {
  await assert.rejects(() => readStatementFile(enc.encode('PK\u0003\u0004basura')), isImport('format'));
  await assert.rejects(() => readStatementFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), isImport('unsupported'));
  await assert.rejects(() => readStatementFile(enc.encode('a;"sin cerrar\n')), isImport('format'));
  const table = readCsv(enc.encode('uno;dos;tres\n1;2;3\n'));
  assert.throws(() => tableToRaws(table.rows, detectLayout(table.rows), table), isImport('columns'));
  await assert.rejects(() => readStatementFile(new Uint8Array(11 * 1024 * 1024)), isImport('size'));
});

test('archivos: una bomba ZIP se corta al superar el límite descomprimido', async () => {
  const huge = 'A'.repeat(41 * 1024 * 1024);
  const files = { ...XLSX_FILES, 'xl/worksheets/sheet1.xml': huge };
  const zip = await makeZip(files, { deflate: true, fakeSize: 100 });
  assert.ok(zip.length < 1024 * 1024, 'el archivo comprimido es pequeño');
  await assert.rejects(() => readStatementFile(zip), isImport('size'));
});
