import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as drizzleSql } from 'drizzle-orm';
import * as schema from './schema/index.js';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL not set');
}

// Single shared connection pool. Workers share this.
// Adjust `max` based on worker concurrency × queue count.
const queryClient = postgres(url, {
  max: Number(process.env.DB_POOL_MAX ?? 20),
  idle_timeout: 30,
  connect_timeout: 10,
});

export const db = drizzle(queryClient, { schema });
// Drizzle's tagged-template SQL builder. Use for `db.execute(sql\`...\`)`.
export const sql = drizzleSql;
// Raw postgres-js client — escape hatch for cases drizzle can't express.
export const rawPg = queryClient;
export type Db = typeof db;
export { schema };
