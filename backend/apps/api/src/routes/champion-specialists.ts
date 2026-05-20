// GET /api/champions/:championId/specialists?bracket=&lane=&limit=
//   Top players ranked by games-on-this-champion in the chosen bracket.
//
// For each top puuid, we also surface their most-recent match's first 3
// items + summoner spells + keystone rune so the UI can render a compact
// "장인 랭킹" card without round-tripping to /matches for each player.
//
// Cache: 10 min. Specialist lists shift slowly; aggressive cache cuts
// the heavy CTE (4-way join + DISTINCT ON) to one trip during traffic
// bursts on a champion detail page.

import type { FastifyInstance } from 'fastify';
import { db, sql } from '@lol-tracker/db';
import { cache } from '../cache.js';

const TTL_SEC = 10 * 60;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Bracket → tier whitelist. Aligned with champion_stats bracket buckets.
const BRACKET_TIERS: Record<string, string[]> = {
  'challenger': ['CHALLENGER'],
  'gm+':        ['CHALLENGER', 'GRANDMASTER'],
  'master+':    ['CHALLENGER', 'GRANDMASTER', 'MASTER'],
  'diamond+':   ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'],
  'emerald+':   ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD'],
};

interface SpecialistsQuery { bracket?: string; lane?: string; limit?: string; }

export default async function championSpecialistsRoutes(app: FastifyInstance) {
  app.get<{ Params: { championId: string }; Querystring: SpecialistsQuery }>(
    '/api/champions/:championId/specialists',
    async (req, reply) => {
      const championId = Number(req.params.championId);
      if (!Number.isFinite(championId)) return reply.status(400).send({ error: 'bad championId' });
      const bracket = req.query.bracket ?? 'diamond+';
      const lane = req.query.lane && req.query.lane !== 'all' ? req.query.lane : null;
      const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit ?? DEFAULT_LIMIT)));

      const tiers: string[] = BRACKET_TIERS[bracket] ?? BRACKET_TIERS['diamond+']!;

      const cacheKey = `champ-specialists:${championId}:${bracket}:${lane ?? 'all'}:${limit}`;
      return cache(cacheKey, TTL_SEC, async () => {
        // Single query that:
        // 1. Filters match_participants to this champion (+optional lane)
        // 2. Joins league_entries (solo) for the tier filter
        // 3. Aggregates per puuid: games / wins / avgKda
        // 4. LATERAL joins the most recent match for that puuid+champ to
        //    grab items / spells / keystone for the UI strip
        const rows = await db.execute(sql`
          WITH player_tier AS (
            SELECT DISTINCT ON (puuid) puuid, tier, rank, league_points
            FROM league_entries
            WHERE queue_type = 'RANKED_SOLO_5x5'
            ORDER BY puuid, refreshed_at DESC
          ),
          champ_games AS (
            SELECT mp.puuid,
                   COUNT(*)::int AS games,
                   COUNT(*) FILTER (WHERE mp.win)::int AS wins,
                   AVG((mp.kills + mp.assists)::float / GREATEST(mp.deaths, 1))::float AS avg_kda,
                   AVG(COALESCE(mp.ai_score_cached, 50)::float)::float AS avg_ai
            FROM match_participants mp
            WHERE mp.champion_id = ${championId}
              ${lane ? sql`AND mp.lane = ${lane}` : sql``}
            GROUP BY mp.puuid
            HAVING COUNT(*) >= 5
          ),
          ranked AS (
            SELECT cg.puuid, cg.games, cg.wins, cg.avg_kda, cg.avg_ai,
                   pt.tier, pt.rank, pt.league_points
            FROM champ_games cg
            JOIN player_tier pt ON pt.puuid = cg.puuid
            WHERE pt.tier = ANY(ARRAY[${sql.join(tiers.map((t) => sql`${t}`), sql`, `)}]::text[])
            ORDER BY cg.games DESC, cg.wins DESC
            LIMIT ${limit}
          )
          SELECT
            r.puuid, r.games, r.wins, r.avg_kda AS "avgKda", r.avg_ai AS "avgAi",
            r.tier, r.rank, r.league_points AS "lp",
            a.game_name AS "gameName", a.tag_line AS "tagLine",
            s.profile_icon_id AS "profileIconId",
            recent.items, recent.spells, recent.runes
          FROM ranked r
          LEFT JOIN accounts  a ON a.puuid = r.puuid
          LEFT JOIN summoners s ON s.puuid = r.puuid
          LEFT JOIN LATERAL (
            SELECT mp.items, mp.spells, mp.runes
            FROM match_participants mp
            JOIN matches m ON m.match_id = mp.match_id
            WHERE mp.puuid = r.puuid
              AND mp.champion_id = ${championId}
              ${lane ? sql`AND mp.lane = ${lane}` : sql``}
            ORDER BY m.game_creation DESC
            LIMIT 1
          ) recent ON true
          ORDER BY r.games DESC, r.wins DESC
        `);

        // Static runes lookup for keystone icon resolution.
        const runeRows = await db.execute(sql`
          SELECT DISTINCT ON (id) id, icon_path
          FROM static_runes ORDER BY id, patch DESC
        `);
        const runeIcon = new Map<number, string>();
        for (const r of runeRows as unknown as Array<{ id: number; icon_path: string }>) {
          runeIcon.set(r.id, r.icon_path);
        }

        type Row = {
          puuid: string; games: number; wins: number; avgKda: number; avgAi: number;
          tier: string; rank: string; lp: number;
          gameName: string | null; tagLine: string | null; profileIconId: number | null;
          items: number[] | null; spells: number[] | null;
          runes: { styles?: Array<{ style: number; selections: Array<{ perk: number }> }> } | null;
        };

        const specialists = (rows as unknown as Row[]).map((r) => {
          const keystone = r.runes?.styles?.[0]?.selections?.[0]?.perk ?? null;
          const subStyle = r.runes?.styles?.[1]?.style ?? null;
          // First 3 inventory items (skip 0 = empty, skip trinket slot 6).
          const firstItems = (r.items ?? []).slice(0, 6).filter((id) => id > 0).slice(0, 3);
          return {
            puuid: r.puuid,
            gameName: r.gameName,
            tagLine:  r.tagLine,
            profileIconId: r.profileIconId,
            tier: r.tier, rank: r.rank, lp: r.lp,
            games: r.games,
            wins: r.wins,
            winrate: r.games > 0 ? Math.round((r.wins / r.games) * 1000) / 10 : 0,
            avgKda: Math.round(r.avgKda * 100) / 100,
            avgAi:  Math.round(r.avgAi * 10) / 10,
            firstItems,
            spells: (r.spells ?? []).slice(0, 2),
            keystoneId: keystone,
            keystoneIcon: keystone ? (runeIcon.get(keystone) ?? null) : null,
            subStyleId: subStyle,
          };
        });

        return { championId, bracket, lane, specialists };
      });
    },
  );
}
