import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceKind, shortDeviceCode } from '../lib/device-kind.ts';

test('browser connections are distinct from installed POS and unknown clients', () => {
  assert.equal(deviceKind('WEB-1ce9352c-uuid-store-uuid'), 'web');
  assert.equal(deviceKind('POS-7418f8e0-uuid'), 'pos');
  assert.equal(deviceKind('old-device-uuid'), 'other');
});

test('short browser code omits the store UUID and keeps a stable identifier', () => {
  assert.equal(shortDeviceCode('WEB-1ce9352c-uuid-store-uuid'), '1CE9352C');
  assert.equal(shortDeviceCode('POS-7418f8e0-uuid'), '7418F8E0');
});
