import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const root = resolve(process.cwd(), '../..');
const stateDir = join(root, '.mvp-local');
const pendingDir = join(stateDir, 'backups', 'weekly-pending');
const backupScript = join(root, 'tools', 'weekly-offsite-backup.ps1');
const bundlePattern = /^weekly-(\d{8})T(\d{6})Z-[0-9a-f]{8}$/;
let running = false;

function enabled() {
  return process.platform === 'win32' && process.env.KOREACRM_LOCAL_BACKUP_ENABLED === '1' &&
    process.env.KOREACRM_API_PROXY_TARGET?.startsWith('http://127.0.0.1:') === true;
}

async function owner(request: NextRequest) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return false;
  const response = await fetch(`${process.env.KOREACRM_API_PROXY_TARGET}/auth/me`, {
    headers: { authorization }, cache: 'no-store', signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response?.ok) return false;
  const me = await response.json() as { role?: string };
  return me.role === 'OWNER' || me.role === 'SUPERUSER';
}

async function status() {
  const names = await readdir(pendingDir).catch(() => []);
  const bundles = names.filter(name => bundlePattern.test(name)).sort().reverse();
  const serverConfigured = await stat(join(stateDir, 'weekly-offsite.json')).then(item => item.isFile()).catch(() => false);
  return {
    available: true,
    running,
    pending: bundles.length,
    lastCreatedAt: bundles[0] ? `${bundles[0].slice(7, 11)}-${bundles[0].slice(11, 13)}-${bundles[0].slice(13, 15)}T${bundles[0].slice(16, 18)}:${bundles[0].slice(18, 20)}:${bundles[0].slice(20, 22)}Z` : null,
    serverConfigured,
  };
}

function runBackup(): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', backupScript], {
      cwd: root, windowsHide: true, shell: false,
    });
    let errorOutput = '';
    child.stderr.on('data', (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString()).slice(-4000); });
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) done();
      else reject(new Error(errorOutput || `Backup process exited with code ${code}`));
    });
  });
}

export async function GET(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ available: false }, { status: 404 });
  if (!(await owner(request))) return NextResponse.json({ message: 'Нет доступа.' }, { status: 403 });
  return NextResponse.json(await status(), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  if (!enabled()) return NextResponse.json({ available: false }, { status: 404 });
  if (!(await owner(request))) return NextResponse.json({ message: 'Нет доступа.' }, { status: 403 });
  if (running) return NextResponse.json({ message: 'Копирование уже выполняется.' }, { status: 409 });
  running = true;
  try {
    await runBackup();
    return NextResponse.json({ ...await status(), running: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ message: 'Не удалось завершить копирование. Локальные данные сохранены. Проверьте журнал задачи или обратитесь к администратору.' }, { status: 500 });
  } finally {
    running = false;
  }
}
