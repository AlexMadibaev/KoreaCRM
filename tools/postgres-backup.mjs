import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

process.umask(0o077);
const command = process.argv[2];
const limits = { daily: 14, weekly: 8, monthly: 6 };
const archivePattern = /^backup-(\d{8})T\d{6}Z-[0-9a-f]{8}\.dump$/;

function postgresUrl(raw) {
  if (!raw) throw new Error('Database URL is required');
  const url = new URL(raw);
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('Expected a PostgreSQL URL');
  url.searchParams.delete('schema'); // Prisma accepts this parameter; libpq does not.
  return url.toString();
}

function pgTool(name) {
  const binary = `${name}${process.platform === 'win32' ? '.exe' : ''}`;
  return process.env.PG_BIN_DIR ? join(process.env.PG_BIN_DIR, binary) : binary;
}

async function run(name, args, secret) {
  const output = await new Promise((done, reject) => {
    const child = spawn(pgTool(name), args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.stderr.on('data', (chunk) => { err += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? done(out) : reject(new Error(`${name} exited ${code}: ${err.replaceAll(secret, '[REDACTED]').trim()}`)));
  });
  return output;
}

function isoWeek(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
  const year = day.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  return `${year}-W${String(Math.ceil(((day - first) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

export function retainedArchives(names, tier, limit) {
  const buckets = new Set();
  const kept = []; const removed = [];
  for (const name of [...names].filter((item) => archivePattern.test(item)).sort().reverse()) {
    const match = archivePattern.exec(name);
    const date = match[1];
    const day = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
    const bucket = tier === 'daily' ? date : tier === 'weekly' ? isoWeek(day) : date.slice(0, 6);
    if (buckets.has(bucket) || buckets.size >= limit) removed.push(name);
    else { buckets.add(bucket); kept.push(name); }
  }
  return { kept, removed };
}

async function backup() {
  const url = postgresUrl(process.env.DATABASE_URL);
  const directory = resolve(process.env.BACKUP_DIR ?? 'backups');
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}/, '');
  const filename = `backup-${stamp}-${randomBytes(4).toString('hex')}.dump`;
  const temporary = join(directory, `${filename}.tmp`);
  try {
    await run('pg_dump', ['--format=custom', '--file', temporary, '--dbname', url], url);
    await run('pg_restore', ['--list', temporary], url);
    const size = (await stat(temporary)).size;
    if (size < 100) throw new Error('Backup archive is unexpectedly small');
    for (const [tier, limit] of Object.entries(limits)) {
      const folder = join(directory, tier);
      await mkdir(folder, { recursive: true });
      const staged = join(folder, `${filename}.tmp`);
      await copyFile(temporary, staged);
      await rename(staged, join(folder, filename));
      const { removed } = retainedArchives(await readdir(folder), tier, limit);
      for (const old of removed) await rm(join(folder, old));
    }
    console.log(JSON.stringify({ result: 'ok', archive: filename, bytes: size, tiers: Object.keys(limits) }));
  } finally { await rm(temporary, { force: true }); }
}

async function restore() {
  const url = postgresUrl(process.env.RESTORE_DATABASE_URL);
  const archive = resolve(process.env.BACKUP_FILE ?? '');
  if (!process.env.BACKUP_FILE || !archivePattern.test(basename(archive))) throw new Error('BACKUP_FILE must be an archive made by postgres-backup.mjs');
  if (!(await stat(archive)).isFile()) throw new Error('BACKUP_FILE is not a file');
  await run('pg_restore', ['--list', archive], url);
  await run('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', url, archive], url);
  console.log(JSON.stringify({ result: 'ok', restoredArchive: basename(archive) }));
}

if (command === 'backup') await backup();
else if (command === 'restore') await restore();
else if (process.argv[1] && process.argv[1].endsWith('postgres-backup.mjs')) throw new Error('Usage: node tools/postgres-backup.mjs backup|restore');
