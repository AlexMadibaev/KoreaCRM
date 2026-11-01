import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchStableCatalog } from '../src/stable-catalog.ts';

test('catalog retries when its revision changes during download', async () => {
  const revisions = ['old', 'new', 'new', 'new'];
  let downloads = 0;
  let retries = 0;
  const snapshot = await fetchStableCatalog(
    async () => revisions.shift(),
    async () => [{ value: ++downloads }],
    async () => [],
    () => { retries += 1; },
  );
  assert.equal(snapshot.revision, 'new');
  assert.deepEqual(snapshot.products, [{ value: 2 }]);
  assert.equal(retries, 1);
});

test('catalog refuses to save an unstable snapshot', async () => {
  let revision = 0;
  let downloads = 0;
  await assert.rejects(
    fetchStableCatalog(
      async () => String(++revision),
      async () => { downloads += 1; return []; },
      async () => [],
      () => {},
    ),
    /изменились во время загрузки/,
  );
  assert.equal(downloads, 3);
});
