// Centralized env access. Throws fast on missing required vars.
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve backend/.env from apps/worker/src/ regardless of cwd.
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

export const env = {
  RIOT_API_KEY: required('RIOT_API_KEY'),
  DATABASE_URL: required('DATABASE_URL'),
  REDIS_URL: required('REDIS_URL'),
  // Personal Riot key sustains ~0.83 req/sec (100/2min). Each puuid job
  // makes ~5 API calls and each match-detail ~1.5 — total concurrency is
  // sized so the bottleneck reservoir wait stays under the job timeout
  // under sustained load. Bump these once a Production key is approved.
  WORKER_MATCH_ID_CONCURRENCY: num('WORKER_MATCH_ID_CONCURRENCY', 2),
  WORKER_MATCH_DETAIL_CONCURRENCY: num('WORKER_MATCH_DETAIL_CONCURRENCY', 4),
  SEED_REGION: process.env.SEED_REGION ?? 'kr',
  SEED_BRACKET: process.env.SEED_BRACKET ?? 'diamond+',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  RIOT_KEY_TIER: (process.env.RIOT_KEY_TIER ?? 'prod') as 'dev' | 'personal' | 'prod',
};
