import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from '../apps/web/node_modules/exceljs/excel.js';
import { readXlsx, writeXlsx } from '../apps/web/lib/xlsx.ts';

test('XLSX round trip preserves Russian text, leading-zero SKU and literal formula text', async () => {
  const rows = [['SKU', 'Название', 'Бренд'], ['00123', 'Крем «Ночь»', 'Тест'], ['=1+1', 'Строка с формулой', '']];
  assert.deepEqual(await readXlsx(await writeXlsx(rows)), rows);
});

test('XLSX reader preserves zero-padded numeric cell display', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Товары');
  sheet.addRow(['SKU', 'Название']);
  sheet.addRow([123, 'Крем']);
  sheet.getCell('A2').numFmt = '000000';
  assert.deepEqual(await readXlsx(await workbook.xlsx.writeBuffer()), [['SKU', 'Название'], ['000123', 'Крем']]);
});
