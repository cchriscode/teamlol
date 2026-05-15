// One-shot backfill launcher for PM2 (no auto-restart).
// Spawns `pnpm cli backfill` and exits when done.
const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn('pnpm', ['--filter', '@lol-tracker/worker', 'cli', 'backfill'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) { console.log(`[backfill] terminated by signal ${signal}`); process.exit(1); }
  console.log(`[backfill] exited with code ${code}`);
  process.exit(code ?? 0);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
