import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv, serializeCsv } from '../apps/web/lib/csv.ts';

test('CSV round trip handles Russian text, separators, quotes and line breaks', () => {
  const rows = [['SKU', 'Название'], ['A;1', 'Товар, "тест"'], ['B2', 'Первая строка\nВторая строка']];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});

test('CSV reads comma-separated files and rejects open quotes', () => {
  assert.deepEqual(parseCsv('sku,name\r\nA,One'), [['sku', 'name'], ['A', 'One']]);
  assert.deepEqual(parseCsv('"Название, полное";SKU\n"Товар, тест";A'), [['Название, полное', 'SKU'], ['Товар, тест', 'A']]);
  assert.throws(() => parseCsv('sku,name\nA,"open'), /Незакрытая кавычка/);
});

test('CSV export escapes spreadsheet formulas', () => {
  assert.match(serializeCsv([['=1+1']]), /^\uFEFF"'=1\+1"$/);
});
