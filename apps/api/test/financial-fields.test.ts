import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { firstValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { FinancialFieldsInterceptor, redactFinancialFields } from '../src/auth/financial-fields';

test('consultants cannot see financial fields inside receipts, returns, settings and histories', () => {
  const at = new Date();
  const price = new Prisma.Decimal(100);
  const response = { totalMinor: price, createdAt: at, costMinor: '60', profitMinor: '40', items: [{ priceMinor: '100', purchasePriceMinor: '60', profitMinor: '40', batch: { purchasePriceMinor: '60' } }], returns: [{ costMinor: '20', amountMinor: '30' }], settings: { costBasisMinor: '60', priceMinor: '100' }, marginPercent: '40' };
  const safe = redactFinancialFields(response, { permissions: ['sales.view', 'products.view'] }) as Record<string, unknown>;
  assert.deepEqual(safe, { totalMinor: price, createdAt: at, items: [{ priceMinor: '100', batch: {} }], returns: [{ amountMinor: '30' }], settings: { priceMinor: '100' } });
  assert.equal(safe.totalMinor, price); assert.equal(safe.createdAt, at);
  assert.equal(response.items[0]!.purchasePriceMinor, '60');
});
test('purchasing permission grants cost but does not grant profit or margin', () => {
  assert.deepEqual(redactFinancialFields({ costMinor: '60', purchasePriceMinor: '60', profitMinor: '40', marginPercent: '40' }, { permissions: ['purchases.view'] }), { costMinor: '60', purchasePriceMinor: '60' });
});
test('finance viewers retain the complete response and missing access gets no financial fields', () => {
  const response = { costMinor: '60', profitMinor: '40', totalMinor: '100' };
  assert.equal(redactFinancialFields(response, { permissions: ['finance.view'] }), response);
  assert.deepEqual(redactFinancialFields(response), { totalMinor: '100' });
});
test('response interceptor uses permissions of the actual authenticated request', async () => {
  const context = { switchToHttp: () => ({ getRequest: () => ({ access: { permissions: ['sales.view'] } }) }) } as unknown as ExecutionContext;
  const result = await firstValueFrom(new FinancialFieldsInterceptor().intercept(context, { handle: () => of({ sale: { totalMinor: '100', profitMinor: '40' } }) }));
  assert.deepEqual(result, { sale: { totalMinor: '100' } });
});