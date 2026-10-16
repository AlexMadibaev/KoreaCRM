import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);

test('configuration snapshot restores files and rejects altered content', async () => {
  const parent = resolve('tools/pg-test-data');
  const root = join(parent, `config-test-${randomUUID()}`);
  assert.ok(relative(parent, root) && !relative(parent, root).startsWith('..'));
  const source = join(root, 'source');
  const archive = join(root, 'backups');
  const restored = join(root, 'restored');
  await mkdir(join(source, 'nested'), { recursive: true });
  await writeFile(join(source, '.env'), 'TEST_SECRET=local-only\n');
  await writeFile(join(source, 'compose.yaml'), 'services: {}\n');
  await writeFile(join(source, 'nested', 'site.conf'), 'server {}\n');
  try {
    const { stdout } = await run(process.execPath, ['tools/config-backup.mjs', 'backup'], { env: { ...process.env, CONFIG_ROOT: source, CONFIG_PATHS: '.env,compose.yaml,nested/site.conf', BACKUP_DIR: archive } });
    const { snapshot } = JSON.parse(stdout);
    const snapshotPath = join(archive, 'config', snapshot);
    await run(process.execPath, ['tools/config-backup.mjs', 'restore'], { env: { ...process.env, CONFIG_SNAPSHOT: snapshotPath, CONFIG_RESTORE_DIR: restored } });
    assert.equal(await readFile(join(restored, '.env'), 'utf8'), 'TEST_SECRET=local-only\n');
    assert.equal(await readFile(join(restored, 'nested', 'site.conf'), 'utf8'), 'server {}\n');
    await writeFile(join(snapshotPath, 'compose.yaml'), 'altered\n');
    await assert.rejects(run(process.execPath, ['tools/config-backup.mjs', 'restore'], { env: { ...process.env, CONFIG_SNAPSHOT: snapshotPath, CONFIG_RESTORE_DIR: join(root, 'tampered') } }), /Checksum mismatch/);
    assert.equal((await readdir(join(root, 'tampered'))).length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
