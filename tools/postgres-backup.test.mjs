import assert from 'node:assert/strict';
import test from 'node:test';
import { retainedArchives } from './postgres-backup.mjs';

const archive = (day, time = '020000', suffix = '12345678') => `backup-${day}T${time}Z-${suffix}.dump`;

test('daily rotation keeps the newest archive for each of 14 days', () => {
  const names = Array.from({ length: 16 }, (_, index) => archive(`202610${String(index + 1).padStart(2, '0')}`));
  names.push(archive('20261016', '030000', 'abcdef12'));
  const result = retainedArchives(names, 'daily', 14);
  assert.equal(result.kept.length, 14);
  assert.ok(result.kept.includes(archive('20261016', '030000', 'abcdef12')));
  assert.ok(result.removed.includes(archive('20261001')));
  assert.ok(result.removed.includes(archive('20261016')));
});

test('weekly rotation groups dates across the ISO year boundary', () => {
  const result = retainedArchives([archive('20251229'), archive('20260101'), archive('20260105')], 'weekly', 8);
  assert.deepEqual(result.kept, [archive('20260105'), archive('20260101')]);
  assert.deepEqual(result.removed, [archive('20251229')]);
});

test('monthly rotation keeps six newest months and ignores unrelated files', () => {
  const names = ['notes.txt', ...Array.from({ length: 8 }, (_, index) => archive(`2026${String(index + 1).padStart(2, '0')}01`))];
  const result = retainedArchives(names, 'monthly', 6);
  assert.equal(result.kept.length, 6);
  assert.deepEqual(result.removed, [archive('20260201'), archive('20260101')]);
});
