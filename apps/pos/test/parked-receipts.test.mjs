import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultParkedLabel, maxParkedReceipts, parkReceipt, readParked, writeParked } from '../src/parked-receipts.ts';

const memory = () => { const data = new Map(); return { getItem: name => data.get(name) ?? null, setItem: (name, value) => data.set(name, value), removeItem: name => data.delete(name), data }; };

test('parked receipts are kept per store and till and removed when empty', () => {
  const storage = memory();
  const parked = parkReceipt([], { label: 'Чек 1', lines: [{ id: 'p1', quantity: 2 }], customer: null }, new Date('2026-11-02T10:00:00Z'), 'r1');
  writeParked(storage, 'store', 'POS-1', parked);
  assert.deepEqual(readParked(storage, 'store', 'POS-1'), parked);
  assert.deepEqual(readParked(storage, 'store', 'POS-2'), []);
  writeParked(storage, 'store', 'POS-1', []);
  assert.equal(storage.data.size, 0);
});

test('parking refuses more than the limit and broken storage reads as empty', () => {
  const full = Array.from({ length: maxParkedReceipts }, (_, index) => ({ id: String(index), label: '', createdAt: '', lines: [], customer: null }));
  assert.throws(() => parkReceipt(full, { label: 'x', lines: [], customer: null }));
  assert.deepEqual(readParked({ getItem: () => '{broken' }, 'store', 'POS-1'), []);
  assert.equal(defaultParkedLabel(2, 'Анна'), 'Чек 3 · Анна');
});
