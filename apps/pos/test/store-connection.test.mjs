import assert from 'node:assert/strict';
import test from 'node:test';
import { readStoreConnection, requireMatchingStore, saveStoreConnection } from '../src/store-connection.ts';

test('store setup persists per API and normalizes trailing slashes', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = { id: 'store-1', name: 'Sadbarg', code: 'SADBARG' };
  saveStoreConnection(storage, 'https://shop.test/api/', store);
  assert.deepEqual(readStoreConnection(storage, 'https://shop.test/api'), store);
  assert.equal(readStoreConnection(storage, 'https://other.test/api'), null);
  assert.doesNotThrow(() => requireMatchingStore(store, 'store-1'));
  assert.throws(() => requireMatchingStore(store, 'store-2'));
  assert.throws(() => requireMatchingStore(null, 'store-1'));
});

test('broken or incomplete store setup requires setup again', () => {
  assert.equal(readStoreConnection({ getItem: () => '{' }, 'server'), null);
  assert.equal(readStoreConnection({ getItem: () => JSON.stringify({ id: 'store-1' }) }, 'server'), null);
});
