import assert from 'node:assert/strict';
import test from 'node:test';
import { createScannerInput } from '../src/scanner-input.ts';

test('scanner burst is consumed once, with or without a suffix', () => {
  const input = createScannerInput();
  [...'4601234567890'].forEach((key, index) => input.push(key, index * 10));
  assert.equal(input.take(), '4601234567890');
  assert.equal(input.take(), undefined);
});

test('normal typing and short hotkeys do not become scanner input', () => {
  const input = createScannerInput();
  [...'cream'].forEach((key, index) => input.push(key, index * 200));
  assert.equal(input.take(), undefined);
  input.push('f', 2000);
  assert.equal(input.take(), undefined);
});

test('reset discards scanner input when editing another field', () => {
  const input = createScannerInput();
  [...'1234'].forEach((key, index) => input.push(key, index * 10));
  input.reset();
  assert.equal(input.take(), undefined);
});
