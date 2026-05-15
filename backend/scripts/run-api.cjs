// Launcher: PM2 spawns this Node.js script, which then spawns pnpm via shell.
// Works cross-platform (Windows .cmd handled by `shell: true`).
const { spawn } = require('node:child_process');
const path = require('node:path');

const child = spawn('pnpm', ['--filter', '@lol-tracker/api', 'start'], {
  cwd: path.resolve(__dirname, '..'),
  stdio: 'inherit',
  shell: true,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[run-api] child terminated by signal ${signal}`);
    process.exit(1);
  }
  console.log(`[run-api] child exited with code ${code}`);
  process.exit(code ?? 1);
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
