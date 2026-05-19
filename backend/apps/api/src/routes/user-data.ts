// GDPR Article 17 / Riot Developer Policy data deletion endpoint.
//
// Accepts a Riot ID, resolves to puuid via ACCOUNT-V1, queues a
// deletion request, returns immediately. Worker processes asynchronously
// (multi-table DELETE) and blocks the puuid from future re-ingest.
//
// Rate-limited per IP (avoid mass-deletion abuse). Ownership is NOT
// cryptographically verified — anyone with a valid Riot ID can request
// deletion of that ID's data. This is acceptable because:
//   1. The data we hold is all public game history (no PII beyond what's
//      already public via Riot's own match history)
//   2. The user can always be re-ingested by searching the Riot ID again
//      unless blocked, and the block is permanent only until the same user
//      requests un-blocking via email.

import type { FastifyInstance } from 'fastify';
import { db, schema, sql } from '@lol-tracker/db';
import { eq } from 'drizzle-orm';
import { REGION_TO_REGIONAL, Region } from '@lol-tracker/shared';
import { riot } from '../riot-client.js';
import { randomBytes } from 'crypto';

interface DeleteBody {
  riotId: string;
  region: string;
}

export default async function userDataRoutes(app: FastifyInstance) {
  app.post<{ Body: DeleteBody }>(
    '/api/user/delete-data',
    {
      // Tight per-IP rate limit — actual deletion is heavy and we want to
      // catch abuse (anyone could DoS the worker by spamming requests).
      config: { rateLimit: { max: 3, timeWindow: '1 hour' } },
    },
    async (req, reply) => {
      const { riotId, region } = req.body ?? {};
      if (typeof riotId !== 'string' || !riotId.includes('#')) {
        return reply.status(400).send({ error: 'riotId must be "이름#태그"' });
      }
      const [name, tag] = riotId.split('#');
      if (!name || !tag) return reply.status(400).send({ error: 'malformed riotId' });
      const regional = REGION_TO_REGIONAL[region as Region];
      if (!regional) return reply.status(400).send({ error: 'invalid region' });

      // Resolve puuid via ACCOUNT-V1. If Riot returns 404, accept the request
      // anyway — user may want to be blocked even if we never ingested them.
      let puuid: string | null = null;
      try {
        const dto = await riot.account.byRiotId(regional, name.trim(), tag.trim());
        puuid = dto.puuid;
      } catch {
        // continue with puuid = null; worker will resolve via DB lookup
      }

      const id = `del_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
      await db.insert(schema.deletionRequests).values({
        id, puuid, riotId: riotId.trim(), region,
        status: 'pending',
      });

      req.log.info({ requestId: id, riotId, puuid }, 'data deletion requested');
      return { requestId: id, status: 'pending', message: '요청이 접수되었습니다' };
    },
  );

  // Lightweight status lookup so a user can confirm processing later.
  app.get<{ Params: { id: string } }>('/api/user/delete-data/:id', async (req, reply) => {
    const row = await db.query.deletionRequests.findFirst({
      where: eq(schema.deletionRequests.id, req.params.id),
    });
    if (!row) return reply.status(404).send({ error: 'not found' });
    return {
      id: row.id, status: row.status,
      requestedAt: row.requestedAt, processedAt: row.processedAt,
      rowsDeleted: row.rowsDeleted, note: row.note,
    };
  });

  // Block list inspection — for transparency. Returns count only, not the
  // raw puuids (those are themselves the sensitive identifier).
  app.get('/api/user/blocked-count', async () => {
    const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM blocked_puuids`);
    return { count: (r as unknown as Array<{ n: number }>)[0]?.n ?? 0 };
  });
}
