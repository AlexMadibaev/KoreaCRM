import assert from 'node:assert/strict';
import test from 'node:test';
import { canAccessStore, hasPermission } from '../src/auth/policy';

const scoped = { userId: 'user-1', permissions: ['products.view'], allStores: false, storeIds: ['store-1'] };

test('permissions require an explicit grant', () => {
  assert.equal(hasPermission(scoped, 'products.view'), true);
  assert.equal(hasPermission(scoped, 'finance.view'), false);
});

test('store scope allows assigned stores only', () => {
  assert.equal(canAccessStore(scoped, 'store-1'), true);
  assert.equal(canAccessStore(scoped, 'store-2'), false);
  assert.equal(canAccessStore({ ...scoped, allStores: true }, 'store-2'), true);
});
