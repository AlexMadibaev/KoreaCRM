import assert from 'node:assert/strict';
import test from 'node:test';
import { errorDetail } from '../src/error-text.ts';

test('native cache rejection retains the SQLite error returned as a string', () => {
  assert.equal(errorDetail('database is locked'), 'database is locked');
  assert.equal(errorDetail('invalid args `snapshot`: expected a string'), 'invalid args `snapshot`: expected a string');
});

test('error details also accept JS errors and structured bridge errors', () => {
  assert.equal(errorDetail(new Error('disk is full')), 'disk is full');
  assert.equal(errorDetail({ message: 'access denied' }), 'access denied');
  assert.equal(typeof errorDetail(null), 'string');
});
