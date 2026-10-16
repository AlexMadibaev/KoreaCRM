import assert from 'node:assert/strict';
import test from 'node:test';
import { drainQueue } from '../src/queue-drain.ts';

test('queue retries the same operation IDs after a network failure', async () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({ operationId: `sale-${index}`, payloadJson: '{}', status: 'PENDING' }));
  const status = new Map(entries.map(entry => [entry.operationId, entry.status]));
  const received = new Set();
  let fail = true;
  const send = async entry => {
    if (fail && entry.operationId === 'sale-10') throw new Error('Network unavailable');
    received.add(entry.operationId);
  };
  const mark = async (entry, next) => { status.set(entry.operationId, next); };
  const first = await drainQueue(entries, send, mark, () => false);
  assert.deepEqual(first, { synced: 10, conflicts: 0, stopped: true });
  assert.equal(status.get('sale-10'), 'ERROR');
  fail = false;
  const second = await drainQueue(entries.filter(entry => status.get(entry.operationId) !== 'SYNCED'), send, mark, () => false);
  assert.deepEqual(second, { synced: 10, conflicts: 0, stopped: false });
  assert.equal(received.size, 20);
  assert.equal(new Set(status.values()).size, 1);
  assert.equal(status.get('sale-19'), 'SYNCED');
});

test('server conflict stays visible while later sales continue', async () => {
  const entries = ['a', 'b'].map(operationId => ({ operationId, payloadJson: '{}', status: 'PENDING' }));
  const result = new Map();
  const outcome = await drainQueue(entries, async entry => { if (entry.operationId === 'a') throw new Error('Conflict'); }, async (entry, status) => { result.set(entry.operationId, status); }, error => error instanceof Error && error.message === 'Conflict');
  assert.deepEqual(outcome, { synced: 1, conflicts: 1, stopped: false });
  assert.equal(result.get('a'), 'CONFLICT');
  assert.equal(result.get('b'), 'SYNCED');
});
