import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve backend/.env from packages/db/ regardless of cwd.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL not set. Copy backend/.env.example to backend/.env');
}

export default defineConfig({
  out: './migrations',
  schema: './src/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
