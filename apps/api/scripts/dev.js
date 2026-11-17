#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');

try {
  execSync('tsc -b', { cwd: pkgDir, stdio: 'inherit' });
} catch {
  // ignore initial compile errors, watch mode will surface them
}

const tsc = spawn('tsc', ['-b', '-w', '--preserveWatchOutput'], {
  cwd: pkgDir,
  stdio: 'inherit'
});

const args = process.argv.slice(2);
const runner = spawn(process.execPath, ['--watch', 'dist/index.js', ...args], {
  cwd: pkgDir,
  stdio: 'inherit'
});

function cleanup() {
  try { tsc.kill('SIGTERM'); } catch {}
  try { runner.kill('SIGTERM'); } catch {}
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

runner.on('exit', (code) => {
  try { tsc.kill('SIGTERM'); } catch {}
  process.exit(code ?? 0);
});
