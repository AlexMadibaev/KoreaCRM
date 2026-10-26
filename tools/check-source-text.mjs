import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const roots = ['apps/api/src', 'apps/web/app', 'apps/web/components', 'apps/web/lib', 'apps/pos/src', 'packages'];
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.prisma']);
const skip = new Set(['node_modules', 'dist', 'target', '.next', '.next-mvp', '.next-preview-discounts', '.next-preview-returns']);
const problems = [];

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { await scan(file); continue; }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) continue;
    const content = await readFile(file, 'utf8');
    for (const [index, line] of content.split(/\r?\n/).entries()) if (/\?{3,}|\uFFFD/.test(line)) problems.push(`${file}:${index + 1}`);
  }
}

for (const root of roots) await scan(root);
if (problems.length) { console.error(`Found broken text encoding in:\n${problems.join('\n')}`); process.exitCode = 1; }
else console.log('Source text encoding: OK');
