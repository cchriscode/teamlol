// Launcher: PM2 spawns this Node.js script, which then spawns pnpm via shell.
// Works cross-platform (Windows .cmd handled by `shell: true`).
const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn('pnpm', ['--filter', '@lol-tracker/worker', 'start'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[run-worker] child terminated by signal ${signal}`);
    process.exit(1);
  }
  console.log(`[run-worker] child exited with code ${code}`);
  process.exit(code ?? 1);
});

// Forward signals so PM2 stop/restart works cleanly.
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
