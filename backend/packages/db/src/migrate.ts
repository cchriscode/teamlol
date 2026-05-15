// Standalone migration runner. Invoked via `pnpm db:migrate`.
// Uses postgres-js + drizzle's migrator (separate from the runtime client).
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Resolve backend/.env from packages/db/ regardless of cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../../.env') });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const migrationClient = postgres(url, { max: 1 });
  try {
    const db = drizzle(migrationClient);
    console.log('[migrate] applying migrations from ./migrations ...');
    await migrate(db, { migrationsFolder: './migrations' });
    console.log('[migrate] done');
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
