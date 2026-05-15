import type { FastifyInstance } from 'fastify';
import { db, sql } from '@lol-tracker/db';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, ts: Date.now() }));

  app.get('/api/health/db', async (_req, reply) => {
    try {
      const r = await db.execute(sql`SELECT 1 AS ok`);
      return { ok: true, db: r };
    } catch (e) {
      reply.status(500);
      return { ok: false, error: (e as Error).message };
    }
  });
}
