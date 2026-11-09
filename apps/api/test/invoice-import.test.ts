import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  invoiceAmounts,
  invoiceSchema,
  isExpenseRow,
  matchInvoiceRow,
} from '../src/purchases/invoice-import';
import { InvoiceImportService } from '../src/purchases/invoice-import.service';
import type { DatabaseService } from '../src/database.service';
import type { PurchasesService } from '../src/purchases/purchases.service';
import { detectInvoiceHeader, invoiceRows } from '../../web/lib/invoice';

const productId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = () =>
  invoiceSchema.parse({
    supplierId: productId,
    number: '00048974',
    date: '2026-11-01',
    filename: 'korlux.xlsx',
    currency: 'USD',
    exchangeRate: '10',
    rows: [
      {
        line: 2,
        barcode: '0012345678901',
        name: 'Skin1004',
        quantity: 200,
        price: '6.67',
        total: '1334',
      },
    ],
  });
const product = {
  id: productId,
  name: 'Skin1004',
  sku: 'FOAM',
  barcodes: [{ value: '0012345678901' }],
};
function service() {
  let writes = 0;
  const db = {
    product: { findMany: async () => [product] },
  } as unknown as DatabaseService;
  const purchases = {
    supplier: async () => ({ status: 'ACTIVE' }),
    createPurchase: async (...args: unknown[]) => {
      writes++;
      return args;
    },
  } as unknown as PurchasesService;
  return {
    service: new InvoiceImportService(db, purchases),
    writes: () => writes,
  };
}

test('invoice prices use decimal arithmetic, discount then exchange rate and half-up minor rounding', () => {
  const row = {
    ...input().rows[0]!,
    price: '7,50',
    quantity: 3,
    discountPercent: '10',
    total: '20.25',
  };
  assert.deepEqual(invoiceAmounts(row, '10'), {
    sourceTotal: '20.25',
    purchasePriceMinor: '6750',
    totalMinor: '20250',
    mismatch: false,
  });
  assert.equal(
    invoiceAmounts(
      { ...row, price: '0.005', discountPercent: '0', total: undefined },
      '1',
    ).purchasePriceMinor,
    '1',
  );
  assert.equal(invoiceAmounts({ ...row, total: '20.24' }, '10').mismatch, true);
  assert.throws(
    () => invoiceAmounts({ ...row, discountPercent: '101' }, '10'),
    BadRequestException,
  );
});

test('invoice validates explicit rates, dates, duplicate line numbers and row limits', () => {
  const value = input();
  assert.equal(
    invoiceSchema.safeParse({ ...value, exchangeRate: '0' }).success,
    false,
  );
  assert.equal(
    invoiceSchema.safeParse({ ...value, currency: 'TJS' }).success,
    false,
  );
  assert.equal(
    invoiceSchema.safeParse({ ...value, date: '2026-02-30' }).success,
    false,
  );
  assert.equal(
    invoiceSchema.safeParse({ ...value, rows: [value.rows[0], value.rows[0]] })
      .success,
    false,
  );
  assert.equal(
    invoiceSchema.safeParse({
      ...value,
      rows: Array.from({ length: 301 }, (_, i) => ({
        ...value.rows[0],
        line: i + 1,
      })),
    }).success,
    false,
  );
});

test('matching preserves barcode priority and variant characteristics', () => {
  const row = input().rows[0]!;
  assert.equal(matchInvoiceRow(row, [product])[0]?.id, productId);
  assert.deepEqual(
    matchInvoiceRow({ ...row, barcode: 'unknown', sku: 'FOAM' }, [product]),
    [],
  );
  assert.deepEqual(
    matchInvoiceRow(
      { ...row, barcode: '', name: 'Skin1004', characteristic: '125ml' },
      [product],
    ),
    [],
  );
  assert.equal(isExpenseRow({ name: 'ТАЧКА', characteristic: '' }), true);
  assert.equal(isExpenseRow({ name: 'Транспортные расходы', characteristic: '' }), true);
  assert.equal(isExpenseRow({ name: 'Skin1004', characteristic: '' }), false);
});

test('preview does not write; confirmation creates a draft with source metadata and converted costs', async () => {
  const fixture = service();
  const value = input();
  const preview = await fixture.service.preview(value);
  assert.equal(preview.canConfirm, true);
  assert.equal(fixture.writes(), 0);
  const args = (await fixture.service.confirm(
    'store',
    value,
    'actor',
  )) as unknown as unknown[];
  assert.equal(fixture.writes(), 1);
  assert.deepEqual(args[1], {
    number: '00048974',
    supplierId: productId,
    items: [{ productId, quantityOrdered: 200, purchasePriceMinor: '6670' }],
  });
  assert.equal((args[3] as { currency: string }).currency, 'USD');
});

test('confirmation rejects mismatches, duplicate products, expenses and excluded rows without reasons', async () => {
  const fixture = service();
  const value = input();
  const row = value.rows[0]!;
  for (const rows of [
    [{ ...row, total: '1' }],
    [row, { ...row, line: 3 }],
    [{ ...row, name: 'ТАЧКА', productId }],
    [row, { ...row, line: 3, excluded: true }],
    [{ ...row, excluded: true, exclusionReason: 'Расход' }],
  ])
    await assert.rejects(
      fixture.service.confirm('store', { ...value, rows }, 'actor'),
      BadRequestException,
    );
  assert.equal(fixture.writes(), 0);
});

test('expense exclusion remains in source document and never becomes a purchase item', async () => {
  const fixture = service();
  const value = input();
  value.rows.push({
    ...value.rows[0]!,
    line: 3,
    name: 'ТАЧКА',
    excluded: true,
    exclusionReason: 'Учесть отдельно как логистику',
  });
  const args = (await fixture.service.confirm(
    'store',
    value,
    'actor',
  )) as unknown as unknown[];
  assert.equal((args[1] as { items: unknown[] }).items.length, 1);
  assert.equal((args[3] as { rows: unknown[] }).rows.length, 2);
});

test('spreadsheet headers below document details, decimal commas and leading barcode zeroes are preserved', () => {
  const matrix = [
    ['KORLUX'],
    ['Номер', '00048974'],
    [
      'Штрихкод',
      'Наименование',
      'Характеристика',
      'Кол-во',
      'Цена',
      'Скидка %',
      'Сумма',
    ],
    ['0012345678901', 'Маска', 'Алоэ', '2', '7,50', '10%', '13,50'],
    ['Итого', '', '', '2', '', '', '13,50'],
  ];
  const detected = detectInvoiceHeader(matrix);
  assert.equal(detected.row, 2);
  const rows = invoiceRows(matrix, detected.mapping, detected.row, 4);
  assert.equal(rows[0]?.barcode, '0012345678901');
  assert.equal(rows[0]?.characteristic, 'Алоэ');
  assert.equal(rows[0]?.price, '7.50');
  assert.equal(rows[0]?.discountPercent, '10');
  assert.equal(rows[0]?.line, 4);
  assert.throws(
    () => invoiceRows(matrix, detected.mapping, detected.row, 5),
    /Строка 5/,
  );
});

test('each mismatched line needs explicit calculation approval and retains supplier amount', async () => {
  const document = input();
  document.rows[0] = { ...document.rows[0]!, quantity: 40, price: '7.84', total: '313.64' };
  const fixture = service();
  assert.equal((await fixture.service.preview(document)).canConfirm, false);
  await assert.rejects(fixture.service.confirm(productId, document, productId), BadRequestException);
  document.rows[0].acceptCalculatedTotal = true;
  const preview = await fixture.service.preview(document);
  assert.equal(preview.canConfirm, true);
  assert.equal(preview.rows[0]!.total, '313.64');
  assert.equal(preview.rows[0]!.sourceTotal, '313.60');
  assert.equal(preview.rows[0]!.mismatch, true);
  const args = await fixture.service.confirm(productId, document, productId) as unknown[];
  const source = args[3] as { rows: { total: string; acceptCalculatedTotal: boolean }[] };
  assert.equal(source.rows[0]!.total, '313.64');
  assert.equal(source.rows[0]!.acceptCalculatedTotal, true);
  document.rows.push({ ...document.rows[0], line: 3, acceptCalculatedTotal: false });
  assert.equal((await fixture.service.preview(document)).canConfirm, false);
});
test('catalogue match works without supplier, document date, currency or exchange rate', async () => {
  const fixture = service();
  const rows = input().rows;
  const results = await fixture.service.match([
    rows[0]!,
    { ...rows[0]!, line: 3, barcode: 'UNKNOWN', name: 'Other product' },
    { ...rows[0]!, line: 4, barcode: '', name: 'Транспортные расходы' },
  ]);
  assert.equal(results[0]!.status, 'FOUND');
  assert.equal(results[0]!.product?.id, productId);
  assert.equal(results[1]!.status, 'NOT_FOUND');
  assert.equal(results[2]!.status, 'EXPENSE');
  assert.equal(fixture.writes(), 0);
});