import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { canOpenReport, localPeriod, reportDefinitions, ReportsService, visibleColumns } from '../src/reports/reports.service';
import { reportKeys } from '../src/reports/reports.schemas';
import type { AccessContext } from '../src/auth/policy';
import type { DatabaseService } from '../src/database.service';

const access = (permissions: string[], extra: Partial<AccessContext> = {}): AccessContext => ({ userId: 'u', permissions, allStores: true, storeIds: [], ...extra });

test('there are 14 reports and each has columns and a valid default sort', () => {
  assert.equal(reportKeys.length, 14);
  for (const key of reportKeys) {
    const definition = reportDefinitions[key];
    assert.ok(definition.columns.some(column => column.key === definition.sort.key), key);
  }
});

test('business days use the Dushanbe calendar (UTC+5)', () => {
  const { range, utcDays } = localPeriod('2026-11-05', '2026-11-05');
  assert.equal(range.gte.toISOString(), '2026-11-04T19:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-11-05T19:00:00.000Z');
  assert.equal(utcDays.gte.toISOString(), '2026-11-05T00:00:00.000Z');
  assert.throws(() => localPeriod('2026-11-05', '2026-11-01'), BadRequestException);
  assert.throws(() => localPeriod('2026-02-30', '2026-03-01'), BadRequestException);
  assert.throws(() => localPeriod('2025-01-01', '2026-11-05'), BadRequestException);
});

test('profit and cost columns are hidden without finance.view', () => {
  const definition = reportDefinitions['sales-by-product'];
  assert.ok(visibleColumns(definition, access(['reports.view', 'sales.view', 'finance.view'])).some(column => column.key === 'profitMinor'));
  assert.ok(!visibleColumns(definition, access(['reports.view', 'sales.view'])).some(column => column.key === 'profitMinor'));
  assert.equal(canOpenReport(reportDefinitions['gross-profit'], access(['reports.view', 'sales.view'])), false);
  assert.equal(canOpenReport(reportDefinitions['sales-by-day'], access(['sales.view'])), false);
});

test('service rejects unknown reports, missing rights and foreign stores before querying', async () => {
  let queries = 0;
  const db = { $queryRaw: async () => { queries++; return []; }, store: { findMany: async () => [] }, category: { findMany: async () => [] } } as unknown as DatabaseService;
  const service = new ReportsService(db);
  const query = { from: '2026-11-01', to: '2026-11-05', page: 1, limit: 50 };
  await assert.rejects(service.run('nope', query, access(['reports.view'])), NotFoundException);
  await assert.rejects(service.run('gross-profit', query, access(['reports.view', 'sales.view'])), ForbiddenException);
  await assert.rejects(service.run('sales-by-day', { ...query, storeId: '00000000-0000-4000-8000-000000000001' }, access(['reports.view', 'sales.view'], { allStores: false, storeIds: [] })), ForbiddenException);
  await assert.rejects(service.run('sales-by-day', { page: 1, limit: 50 }, access(['reports.view', 'sales.view'])), BadRequestException);
  const empty = await service.run('sales-by-day', query, access(['reports.view', 'sales.view'], { allStores: false, storeIds: [] }));
  assert.equal(empty.total, 0);
  assert.equal(queries, 0);
});
