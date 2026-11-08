import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCabinetUi } from '../../../tools/check-cabinet-ui.mjs';

test('all cabinet actions use the shared button system and icon controls have accessible names', () => {
  const result = auditCabinetUi();
  assert.ok(
    result.routes.length >= 36,
    'Audit must cover the complete cabinet route tree.',
  );
  assert.ok(
    result.buttons >= 200,
    'Audit must include page and shared-component controls.',
  );
  assert.deepEqual(result.issues, [], JSON.stringify(result.issues, null, 2));
});
