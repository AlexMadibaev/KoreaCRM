import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCp866 } from '../src/escpos.ts';

test('ESC/POS encoder maps Cyrillic to CP866 and preserves ASCII', () => {
  assert.deepEqual(encodeCp866('АЯапря Ёё'), [0x80, 0x9f, 0xa0, 0xaf, 0xe0, 0xef, 0x20, 0xf0, 0xf1]);
});
