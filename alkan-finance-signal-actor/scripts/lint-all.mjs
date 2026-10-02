// Lightweight syntax lint: runs `node --check` on every source/test file.
// This repo does not use ESLint; we keep the actor dependency-light, so "lint"
// here means "every module parses as valid ESM". Fails the run on any parse error.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['src', 'tests', 'scripts'];
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) files.push(full);
  }
}

for (const r of roots) {
  try { walk(r); } catch { /* dir may not exist */ }
}

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (err) {
    failed++;
    console.error(`LINT FAIL: ${f}\n${err.stderr?.toString() ?? err.message}`);
  }
}

if (failed) {
  console.error(`\n${failed} file(s) failed syntax lint.`);
  process.exit(1);
}
console.log(`Lint OK: ${files.length} files parsed cleanly.`);
