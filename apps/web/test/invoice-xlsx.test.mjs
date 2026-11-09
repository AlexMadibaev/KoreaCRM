import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { readXlsx } from '../lib/xlsx.ts';
import { detectInvoiceHeader, detectInvoiceLastRow, invoiceRows } from '../lib/invoice.ts';

test('XLSX invoice preserves formatted barcode zeroes and characteristics', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Накладная');
  sheet.addRow(['Aitumi: накладная 0000-3613']);
  sheet.addRow(['Штрихкод', 'Наименование', 'Характеристика', 'Количество', 'Цена', 'Сумма']);
  sheet.addRow([12345678901, 'Farmstay Mask', 'Алоэ', 2, 7.5, 15]);
  sheet.getCell('A3').numFmt = '0000000000000';
  const bytes = await workbook.xlsx.writeBuffer();
  const matrix = await readXlsx(new Uint8Array(bytes).buffer);
  const detected = detectInvoiceHeader(matrix);
  const rows = invoiceRows(matrix, detected.mapping, detected.row, matrix.length);
  assert.equal(rows[0].barcode, '0012345678901');
  assert.equal(rows[0].characteristic, 'Алоэ');
  assert.equal(rows[0].quantity, 2);
  assert.equal(rows[0].price, '7.5');
});

test('XLSX invoice refuses more than 300 rows rather than silently truncating goods', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Накладная');
  sheet.addRow(['Наименование', 'Количество', 'Цена']);
  for (let index = 0; index < 301; index++) sheet.addRow([`Товар ${index}`, 1, 10]);
  const bytes = await workbook.xlsx.writeBuffer();
  await assert.rejects(readXlsx(new Uint8Array(bytes).buffer), /300/);
});
test('supplier footer is outside goods and characteristics survive merged print layouts', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Накладная');
  sheet.getCell('B2').value = 'Заказ клиента № 0000-3613';
  sheet.mergeCells('B2:AS2');
  for (const [column, value] of [[4, 'Штрихкод'], [12, 'Товар'], [25, 'Характеристика'], [34, 'Количество'], [40, 'Цена'], [41, 'Сумма']]) sheet.getRow(10).getCell(column).value = value;
  for (let index = 0; index < 30; index++) {
    const row = sheet.getRow(index + 11);
    for (const [column, value] of [[4, `001234567${String(index).padStart(4, '0')}`], [12, 'Маска'], [25, 'ALOE'], [34, 5], [40, 1.9], [41, 9.5]]) row.getCell(column).value = value;
  }
  sheet.getCell('AN42').value = 'Итого:';
  sheet.getCell('AO42').value = 285;
  sheet.getCell('B44').value = 'Всего наименований 30, на сумму 285 сом';
  sheet.getCell('B48').value = 'Кассир:';
  const bytes = await workbook.xlsx.writeBuffer();
  const matrix = await readXlsx(new Uint8Array(bytes).buffer);
  const { mapping, row } = detectInvoiceHeader(matrix);
  const end = detectInvoiceLastRow(matrix, mapping, row);
  const rows = invoiceRows(matrix, mapping, row, end);
  assert.equal(rows.length, 30);
  assert.equal(rows[0].characteristic, 'ALOE');
  assert.equal(rows[0].barcode, '0012345670000');
  assert.equal(rows.reduce((sum, item) => sum + Number(item.total), 0), 285);
});

test('table boundary does not hide goods after an intermediate total', () => {
  const matrix = [['Товар', 'Количество', 'Цена'], ['Маска', '2', '5'], ['Итого:', '', ''], ['Крем', '1', '10']];
  const { mapping, row } = detectInvoiceHeader(matrix);
  assert.equal(detectInvoiceLastRow(matrix, mapping, row), matrix.length);
  assert.throws(() => invoiceRows(matrix, mapping, row, matrix.length), /Строка 3/);
});