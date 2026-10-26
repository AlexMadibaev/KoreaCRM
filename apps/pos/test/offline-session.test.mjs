import assert from 'node:assert/strict';
import test from 'node:test';
import { matchOfflineCode, passwordVerifier } from '../src/offline-session.ts';

test('offline scan accepts only the saved cashier code', async () => {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const verifier = await passwordVerifier('KCRM1:cashier-code', salt);
  const session = { login: 'cashier', salt, verifier };
  assert.equal(await matchOfflineCode('KCRM1:cashier-code', [session]), session);
  assert.equal(await matchOfflineCode('KCRM1:wrong-code', [session]), null);
});
