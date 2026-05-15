// Centralized env access. Same pattern as worker.
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}
function num(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Env ${name} is not a number: ${v}`);
  return n;
}

// Default CORS list = local dev only. Production MUST set API_CORS_ORIGINS
// explicitly (comma-separated). Setting it to '*' is allowed but logged.
// 'null' covers file:// origins (HTML opened directly from disk during dev).
const DEFAULT_CORS = [
  'null',
  'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173',
  'http://localhost:8000', 'http://localhost:8080',
  'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5173',
  'http://127.0.0.1:8000', 'http://127.0.0.1:8080',
];

// IP_SALT: hashes IPs in search_logs. If not set, generate a random per-process
// value so we don't fall back to a predictable default (which would let an
// attacker enumerate which raw IPs hit the search endpoint by precomputing
// hashes). Per-process salts mean log entries from different boots can't be
// correlated by IP — acceptable trade-off for a missing-config dev environment.
const ipSalt = process.env.SEARCH_LOG_IP_SALT
  || (process.env.NODE_ENV === 'production'
      ? (() => { throw new Error('SEARCH_LOG_IP_SALT is required in production'); })()
      : randomBytes(32).toString('hex'));

if (!process.env.SEARCH_LOG_IP_SALT) {
  // eslint-disable-next-line no-console
  console.warn('[env] SEARCH_LOG_IP_SALT not set — using random per-process salt (search_logs IP hashes will not be consistent across restarts)');
}

export const env = {
  DATABASE_URL: required('DATABASE_URL'),
  PORT: num('API_PORT', 3001),
  HOST: process.env.API_HOST ?? '0.0.0.0',
  CORS_ORIGINS: (process.env.API_CORS_ORIGINS ?? DEFAULT_CORS.join(',')).split(',').map((s) => s.trim()).filter(Boolean),
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  DEFAULT_BRACKET: process.env.SEED_BRACKET ?? 'diamond+',
  IP_SALT: ipSalt,
};
