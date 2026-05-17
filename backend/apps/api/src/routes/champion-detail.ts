// GET /api/champions/:championId/detail?lane=mid&bracket=diamond%2B
//   Returns: tier stats + same-lane matchups + best synergies + bot duos.
// Frontend `champion-detail.html` consumes this in one request.
//
// Bucketing: respects bracket param (chal/gm+/master+/diamond+/emerald+).
// Caching: 10 minutes Redis (data changes hourly via aggregator).

import type { FastifyInstance } from 'fastify';
import { db, schema, sql } from '@lol-tracker/db';
import { and, eq, or, desc, gte, inArray } from 'drizzle-orm';
import { cache } from '../cache.js';

const TTL_SEC = 10 * 60;
const MIN_GAMES_MATCHUP = 8;        // post-merge threshold (each pair stored twice in DB so total ≈ 2×)
const MIN_GAMES_SYNERGY = 30;
const TOP_N = 10;

interface DetailQuery { lane?: string; bracket?: string; patch?: string; }

export default async function championDetailRoutes(app: FastifyInstance) {
  app.get<{ Params: { championId: string }; Querystring: DetailQuery }>(
    '/api/champions/:championId/detail',
    async (req, reply) => {
      const championId = Number(req.params.championId);
      if (!Number.isFinite(championId)) return reply.status(400).send({ error: 'bad championId' });
      const bracket = req.query.bracket ?? 'diamond+';
      const lane = req.query.lane;

      const cacheKey = `champ-detail:${championId}:${bracket}:${lane ?? 'all'}`;
      return cache(cacheKey, TTL_SEC, async () => {
        let patch = req.query.patch && req.query.patch !== 'auto' ? req.query.patch : null;
        if (!patch) {
          const r = await db.execute(sql`
            SELECT patch FROM champion_stats WHERE bracket = ${bracket}
            GROUP BY patch ORDER BY SUM(games) DESC LIMIT 1
          `);
          patch = (r as unknown as Array<{ patch: string }>)[0]?.patch ?? null;
        }
        if (!patch) return { patch: null, message: 'no data yet' };

        // Tier rows for this champ across all lanes (so frontend can show lane breakdown).
        const tierRows = await db.select().from(schema.championStats).where(and(
          eq(schema.championStats.patch, patch),
          eq(schema.championStats.bracket, bracket),
          eq(schema.championStats.championId, championId),
        ));

        // Matchups: pull all rows for this champ (don't pre-filter by games —
        // each pair is stored twice, so the merge below combines them and the
        // post-merge filter cuts noise).
        const matchupConditions = [
          eq(schema.championMatchups.patch, patch),
          eq(schema.championMatchups.bracket, bracket),
          or(
            eq(schema.championMatchups.championA, championId),
            eq(schema.championMatchups.championB, championId),
          )!,
        ];
        if (lane) matchupConditions.push(eq(schema.championMatchups.lane, lane));
        const matchups = await db.select().from(schema.championMatchups)
          .where(and(...matchupConditions))
          .limit(2000);

        // Synergies: best synergy delta wins.
        const synergies = await db.select().from(schema.championSynergies).where(and(
          eq(schema.championSynergies.patch, patch),
          eq(schema.championSynergies.bracket, bracket),
          or(
            eq(schema.championSynergies.championA, championId),
            eq(schema.championSynergies.championB, championId),
          ),
          gte(schema.championSynergies.games, MIN_GAMES_SYNERGY),
        ))
        .orderBy(desc(schema.championSynergies.synergyDelta))
        .limit(50);

        // Bot duo (only relevant if champ played adc or support).
        const botDuos = await db.select().from(schema.botDuoSynergy).where(and(
          eq(schema.botDuoSynergy.patch, patch),
          eq(schema.botDuoSynergy.bracket, bracket),
          or(
            eq(schema.botDuoSynergy.adcId, championId),
            eq(schema.botDuoSynergy.supId, championId),
          ),
          gte(schema.botDuoSynergy.games, MIN_GAMES_SYNERGY),
        ))
        .orderBy(desc(schema.botDuoSynergy.synergyDelta))
        .limit(30);

        // Resolve champion meta (this champ + all referenced opponents/partners).
        const referencedIds = new Set<number>([championId]);
        for (const m of matchups) { referencedIds.add(m.championA); referencedIds.add(m.championB); }
        for (const s of synergies) { referencedIds.add(s.championA); referencedIds.add(s.championB); }
        for (const d of botDuos) { referencedIds.add(d.adcId); referencedIds.add(d.supId); }
        const metaRows = referencedIds.size > 0
          ? await db.select({
              id: schema.staticChampions.id,
              key: schema.staticChampions.key,
              nameKr: schema.staticChampions.nameKr,
              tags: schema.staticChampions.tags,
              patch: schema.staticChampions.patch,
            }).from(schema.staticChampions)
            .where(inArray(schema.staticChampions.id, Array.from(referencedIds)))
          : [];
        const metaById = new Map<number, { id: number; key: string; nameKr: string; tags: unknown }>();
        for (const m of metaRows) {
          const cur = metaById.get(m.id);
          if (!cur) metaById.set(m.id, { id: m.id, key: m.key, nameKr: m.nameKr, tags: m.tags });
        }

        // Normalize matchups to "this champ vs opponent" view + split best/worst.
        // Each pair is stored twice in champion_matchups (once per blue side),
        // so merge rows referring to the same opponent before sorting.
        const merged = new Map<string, { lane: string; oppId: number; wins: number; games: number; csSum: number }>();
        for (const r of matchups) {
          const isA = r.championA === championId;
          const oppId = isA ? r.championB : r.championA;
          // Convert to wins for THIS champ. A row's aWins counts wins for championA.
          const myWins = isA ? r.aWins : (r.games - r.aWins);
          const key = `${r.lane}|${oppId}`;
          const cur = merged.get(key);
          if (cur) {
            cur.wins += myWins;
            cur.games += r.games;
            cur.csSum += (r.avgCsDiffAt14 ?? 0) * r.games;
          } else {
            merged.set(key, { lane: r.lane, oppId, wins: myWins, games: r.games, csSum: (r.avgCsDiffAt14 ?? 0) * r.games });
          }
        }
        const matchupsView = Array.from(merged.values())
          .filter((m) => m.games >= MIN_GAMES_MATCHUP)
          .map((m) => {
            const opp = metaById.get(m.oppId);
            return {
              lane: m.lane,
              opponentId: m.oppId,
              opponentKey: opp?.key ?? null,
              opponentNameKr: opp?.nameKr ?? null,
              wr: m.games > 0 ? Math.round((m.wins / m.games) * 10000) / 100 : 0,
              games: m.games,
              csDiffAt14: m.games > 0 ? Math.round((m.csSum / m.games) * 10) / 10 : null,
            };
          })
          .sort((a, b) => b.wr - a.wr);

        const synergiesView = synergies.map((r) => {
          const partnerId = r.championA === championId ? r.championB : r.championA;
          const partner = metaById.get(partnerId);
          return {
            partnerId,
            partnerKey: partner?.key ?? null,
            partnerNameKr: partner?.nameKr ?? null,
            pairWr: r.pairWinrate,
            synergyDelta: r.synergyDelta,
            games: r.games,
          };
        });

        const me = metaById.get(championId);

        return {
          patch, bracket, lane: lane ?? null,
          champion: {
            id: championId,
            key: me?.key ?? null,
            nameKr: me?.nameKr ?? null,
            tags: me?.tags ?? [],
          },
          tier: tierRows.map((r) => ({
            lane: r.lane,
            wr: r.games > 0 ? Math.round((r.wins / r.games) * 10000) / 100 : 0,
            pickrate: r.pickrate, banrate: r.banrate, n: r.sampleN,
            psScore: r.psScore, avgKda: r.avgKda,
          })),
          // Top of the sorted-by-WR list = best, bottom = worst.
          bestMatchups: matchupsView.slice(0, TOP_N),
          worstMatchups: matchupsView.slice(-TOP_N).reverse(),
          synergies: synergiesView.slice(0, TOP_N),
          botDuos: botDuos.map((r) => {
            const adc = metaById.get(r.adcId);
            const sup = metaById.get(r.supId);
            return {
              adcId: r.adcId, adcKey: adc?.key ?? null, adcNameKr: adc?.nameKr ?? null,
              supId: r.supId, supKey: sup?.key ?? null, supNameKr: sup?.nameKr ?? null,
              pairWr: r.pairWinrate, synergyDelta: r.synergyDelta,
              games: r.games, archetype: r.archetype,
            };
          }),
        };
      });
    },
  );
}
