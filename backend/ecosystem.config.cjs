// PM2 process manager config.
// Usage:
//   pm2 start ecosystem.config.cjs       # start all apps
//   pm2 logs lol-worker                  # tail logs
//   pm2 monit                            # CPU/mem live UI
//   pm2 stop lol-worker | restart | delete
//   pm2 startup && pm2 save              # boot persistence

module.exports = {
  apps: [
    {
      name: 'lol-worker',
      // Use a Node launcher to spawn pnpm — works on Windows + Unix.
      script: './scripts/run-worker.cjs',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: './logs/worker-out.log',
      error_file: './logs/worker-err.log',
      merge_logs: true,
      // Aggregators run in a separate process (lol-aggregator) so heavy SQL
      // can't block this worker's BullMQ poll loop / rate-limiter timers.
      env: { NODE_ENV: 'development', AGGREGATORS_ENABLED: 'false' },
    },
    {
      name: 'lol-aggregator',
      script: './scripts/run-aggregator.cjs',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: './logs/aggregator-out.log',
      error_file: './logs/aggregator-err.log',
      merge_logs: true,
      env: { NODE_ENV: 'development' },
    },
    {
      name: 'lol-api',
      script: './scripts/run-api.cjs',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: './logs/api-out.log',
      error_file: './logs/api-err.log',
      merge_logs: true,
      env: { NODE_ENV: 'development' },
    },
  ],
};
