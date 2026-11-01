import assert from 'node:assert/strict';
import test from 'node:test';
import { cashVariance, shiftReportLines, varianceLabel } from '../src/shift-report.ts';

test('variance compares counted cash with the expected balance', () => {
  assert.equal(cashVariance('990', '1000'), -10n);
  assert.equal(cashVariance('', '1000'), null);
  assert.equal(varianceLabel(-1000n), 'Недостача 10,00');
  assert.equal(varianceLabel(250n), 'Излишек 2,50');
  assert.equal(varianceLabel(0n), 'Совпадает');
});

test('closed shift report lists sales, refunds, debt and the closing recount', () => {
  const methods = rows => rows.map(([name, amountMinor]) => ({ paymentMethodId: name, name, kind: 'CASH', amountMinor }));
  const lines = shiftReportLines({
    shift: { id: 's', deviceId: 'POS-1', status: 'CLOSED', openedAt: '2026-11-02T08:00:00Z', closedAt: '2026-11-02T18:00:00Z', openedBy: 'Анна', closedBy: 'Анна', store: { name: 'Магазин', address: null }, openingCashMinor: '10000', openingVarianceMinor: '0', openingComment: null, expectedCashMinor: '29000', actualCashMinor: '29000', closingVarianceMinor: '-1000', closingComment: 'Ошибка сдачи' },
    sales: { count: 2, subtotalMinor: '34500', discountMinor: '0', totalMinor: '34500', debtMinor: '17000', byMethod: methods([['Наличные', '10000'], ['Долг', '17000'], ['Карта', '7500']]) },
    returns: { count: 1, amountMinor: '7500', byMethod: methods([['Карта', '7500']]), receiptlessCount: 0, receiptlessMinor: '0' },
    customerPayments: { count: 1, amountMinor: '7000', byMethod: methods([['Наличные', '7000']]) },
    cash: { openingMinor: '10000', salesMinor: '10000', customerPaymentsMinor: '7000', refundsMinor: '0', depositsMinor: '3000', withdrawalsMinor: '-1000', expensesMinor: '0', correctionsMinor: '-1000', expectedMinor: '29000' },
    operations: [],
  });
  assert.equal(lines[0], 'Z-ОТЧЁТ (СМЕНА ЗАКРЫТА)');
  assert.ok(lines.includes('Продажи: 2 на 345,00'));
  assert.ok(lines.includes('  В долг выдано: 170,00'));
  assert.ok(lines.includes('Погашение долгов: 1 на 70,00'));
  assert.ok(lines.includes('Пересчёт: 290,00 (Недостача 10,00)'));
  assert.ok(lines.includes('  Ошибка сдачи'));
});
