import { createHash, randomBytes } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

process.umask(0o077);
const snapshotPattern = /^config-\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const action = process.argv[2];

function inside(root, path) {
  const rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path must be inside the selected directory');
  return rel;
}

function listedFiles() {
  const paths = (process.env.CONFIG_PATHS ?? '.env,compose.yaml').split(',').map((value) => value.trim()).filter(Boolean);
  if (!paths.length) throw new Error('CONFIG_PATHS is empty');
  for (const path of paths) {
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..') || path === '.') throw new Error(`Unsafe config path: ${path}`);
  }
  return [...new Set(paths)];
}

async function hash(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }

async function backup() {
  const root = resolve(process.env.CONFIG_ROOT ?? '.');
  const folder = resolve(process.env.BACKUP_DIR ?? 'backups', 'config');
  const paths = listedFiles();
  await mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '');
  const name = `config-${stamp}-${randomBytes(4).toString('hex')}`;
  const staging = join(folder, `${name}.tmp`);
  const destination = join(folder, name);
  inside(folder, staging); inside(folder, destination);
  await mkdir(staging);
  try {
    const manifest = [];
    for (const path of paths) {
      const source = resolve(root, path);
      inside(root, source);
      if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${path}`);
      inside(await realpath(root), await realpath(source));
      const target = resolve(staging, path);
      inside(staging, target);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      manifest.push({ path, sha256: await hash(target) });
    }
    await writeFile(join(staging, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), files: manifest }, null, 2));
    await rename(staging, destination);
    const snapshots = (await readdir(folder)).filter((item) => snapshotPattern.test(item)).sort().reverse();
    for (const old of snapshots.slice(14)) {
      const target = resolve(folder, old);
      inside(folder, target);
      await rm(target, { recursive: true });
    }
    console.log(JSON.stringify({ result: 'ok', snapshot: name, files: manifest.length }));
  } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
}

async function restore() {
  const snapshot = resolve(process.env.CONFIG_SNAPSHOT ?? '');
  const targetRoot = resolve(process.env.CONFIG_RESTORE_DIR ?? '');
  if (!process.env.CONFIG_SNAPSHOT || !snapshotPattern.test(snapshot.split(/[\\/]/).at(-1))) throw new Error('CONFIG_SNAPSHOT must be a config-backup snapshot');
  if (!process.env.CONFIG_RESTORE_DIR) throw new Error('CONFIG_RESTORE_DIR is required');
  if (!relative(snapshot, targetRoot).startsWith('..') || !relative(targetRoot, snapshot).startsWith('..')) throw new Error('Restore directory must be separate from snapshot');
  const manifest = JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid snapshot manifest');
  await mkdir(targetRoot, { recursive: true });
  if (!(await lstat(targetRoot)).isDirectory()) throw new Error('CONFIG_RESTORE_DIR must be a regular directory');
  if ((await readdir(targetRoot)).length) throw new Error('CONFIG_RESTORE_DIR must be empty');
  const verified = [];
  for (const file of manifest.files) {
    if (typeof file.path !== 'string' || typeof file.sha256 !== 'string') throw new Error('Invalid snapshot manifest');
    const source = resolve(snapshot, file.path);
    const target = resolve(targetRoot, file.path);
    inside(snapshot, source); inside(targetRoot, target);
    if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${file.path}`);
    inside(await realpath(snapshot), await realpath(source));
    if (await hash(source) !== file.sha256) throw new Error(`Checksum mismatch: ${file.path}`);
    verified.push({ source, target });
  }
  for (const { source, target } of verified) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  console.log(JSON.stringify({ result: 'ok', files: manifest.files.length }));
}

if (action === 'backup') await backup();
else if (action === 'restore') await restore();
else throw new Error('Usage: node tools/config-backup.mjs backup|restore');
