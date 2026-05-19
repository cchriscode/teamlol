// Summoner endpoints — search, profile, matches, refresh trigger.
// On a cache miss the API enqueues a worker job and waits ~1.5s for the worker
// to fill it; if the job hasn't completed in time, returns whatever stub data
// we have plus `cold: true` so the frontend can poll.

import type { FastifyInstance } from 'fastify';
import { db, schema, sql } from '@lol-tracker/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Region, REGION_TO_REGIONAL, parseRiotId, formatRiotId } from '@lol-tracker/shared';
import { redis } from '../redis.js';
import { riot } from '../riot-client.js';
import { env } from '../env.js';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';

const REFRESH_COOLDOWN_MS = 2 * 60 * 1000;
// Riot policy permits up to 24h cache for summoner profile + ranked entries.
// 6h is comfortably below that and aligns with how often a user's level/icon/
// rank actually changes (rank updates only on ranked game end). 5min was
// wasteful and made the dev key burn through its quota on idle refreshes.
const SUMMONER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// PUUID queue (write-only from API; same name as worker uses).
const puuidQueue = new Queue('puuid', { connection: redis });

async function logSearch(req: { ip?: string; headers: { [k: string]: string | string[] | undefined } },
                         riotId: string, region: string, matchedPuuid: string | null) {
  try {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            || req.ip || 'unknown';
    const ipHash = createHash('sha256').update(env.IP_SALT + ':' + ip).digest('hex').slice(0, 32);
    await db.insert(schema.searchLogs).values({
      riotId, region, matchedPuuid, ipHash,
    });
  } catch (_e) {
    // never fail the search because logging failed
  }
}

interface SearchParams { region: string; nameAndTag: string; }
interface PuuidParams { puuid: string; }

export default async function summonerRoutes(app: FastifyInstance) {
  // ---- GET /api/summoner/:region/:nameAndTag ----------------------------
  // nameAndTag is "Hide on bush#KR1" url-encoded.
  app.get<{ Params: SearchParams }>('/api/summoner/:region/:nameAndTag', async (req, reply) => {
    const region = req.params.region as Region;
    if (!REGION_TO_REGIONAL[region]) return reply.status(400).send({ error: 'invalid region' });
    const id = parseRiotId(decodeURIComponent(req.params.nameAndTag));
    if (!id) return reply.status(400).send({ error: 'invalid riot id (use name#tag)' });

    // 1) Account: try DB first.
    let acct = await db.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.gameName, id.gameName),
        eq(schema.accounts.tagLine, id.tagLine),
        eq(schema.accounts.region, region),
      ),
    });

    let cold = false;
    if (!acct) {
      // 2) Cache miss → call Riot directly to resolve PUUID.
      try {
        const dto = await riot.account.byRiotId(REGION_TO_REGIONAL[region], id.gameName, id.tagLine);
        await db.insert(schema.accounts).values({
          puuid: dto.puuid, gameName: dto.gameName, tagLine: dto.tagLine, region,
        }).onConflictDoNothing();
        acct = await db.query.accounts.findFirst({ where: eq(schema.accounts.puuid, dto.puuid) });
        cold = true;
      } catch (e) {
        const status = (e as { status?: number }).status;
        if (status === 404) {
          // Log the failed search too so we know what users couldn't find.
          await logSearch(req, formatRiotId(id), region, null);
          return reply.status(404).send({ error: 'summoner not found' });
        }
        throw e;
      }
    }
    // Successful resolution → log for popular-search aggregation.
    await logSearch(req, formatRiotId(id), region, acct?.puuid ?? null);
    if (!acct) return reply.status(500).send({ error: 'failed to resolve account' });

    // 3) Summoner profile (level + icon).
    let summonerRow = await db.query.summoners.findFirst({ where: eq(schema.summoners.puuid, acct.puuid) });
    const stale = !summonerRow || (Date.now() - summonerRow.refreshedAt.getTime()) > SUMMONER_CACHE_TTL_MS;
    if (stale) {
      try {
        const dto = await riot.summoner.byPuuid(region, acct.puuid);
        await db.insert(schema.summoners).values({
          puuid: acct.puuid, region,
          profileIconId: dto.profileIconId,
          summonerLevel: dto.summonerLevel,
          revisionDate: dto.revisionDate,
        }).onConflictDoUpdate({
          target: schema.summoners.puuid,
          set: {
            profileIconId: dto.profileIconId,
            summonerLevel: dto.summonerLevel,
            revisionDate: dto.revisionDate,
            refreshedAt: new Date(),
          },
        });
        // Construct fresh row (don't spread potentially-null summonerRow).
        summonerRow = {
          puuid: acct.puuid, region,
          profileIconId: dto.profileIconId,
          summonerLevel: dto.summonerLevel,
          revisionDate: dto.revisionDate,
          refreshedAt: new Date(),
        };
      } catch (_e) {
        // Use stale data if Riot fetch fails.
      }
    }

    // 4) League entries (rank).
    let leagueEntries: Array<typeof schema.leagueEntries.$inferSelect> = [];
    leagueEntries = await db.select().from(schema.leagueEntries).where(eq(schema.leagueEntries.puuid, acct.puuid));
    if (leagueEntries.length === 0 || stale) {
      try {
        const dtos = await riot.league.entriesByPuuid(region, acct.puuid);
        for (const dto of dtos) {
          await db.insert(schema.leagueEntries).values({
            puuid: acct.puuid,
            queueType: dto.queueType,
            tier: dto.tier, rank: dto.rank ?? '',
            leaguePoints: dto.leaguePoints,
            wins: dto.wins, losses: dto.losses,
            veteran: dto.veteran, inactive: dto.inactive,
            freshBlood: dto.freshBlood, hotStreak: dto.hotStreak,
            refreshedAt: new Date(),
          }).onConflictDoUpdate({
            target: [schema.leagueEntries.puuid, schema.leagueEntries.queueType],
            set: {
              tier: dto.tier, rank: dto.rank ?? '',
              leaguePoints: dto.leaguePoints,
              wins: dto.wins, losses: dto.losses,
              refreshedAt: new Date(),
            },
          });
        }
        leagueEntries = await db.select().from(schema.leagueEntries).where(eq(schema.leagueEntries.puuid, acct.puuid));
      } catch (_e) { /* keep stale */ }
    }

    // 5) Match count we have for this puuid (so frontend knows whether to refresh).
    const matchCountResult = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM match_participants WHERE puuid = ${acct.puuid}
    `);
    const matchCount = Number((matchCountResult as unknown as Array<{ n: number }>)[0]?.n ?? 0);

    // Auto-trigger deep-collect when we have very few matches for this puuid.
    // Suppressed by Redis lock so repeat visits within 90s don't double-enqueue.
    let deepCollectTriggered = false;
    if (matchCount < 100) {
      const lockKey = `lock:deep-collect:${acct.puuid}`;
      const acquired = await redis.set(lockKey, '1', 'EX', 90, 'NX');
      if (acquired) {
        await puuidQueue.add('puuid', {
          puuid: acct.puuid, region: acct.region, reason: 'deep-collect', deepPages: 5,
        }, {
          jobId: `deep-auto__${acct.puuid}__${Date.now()}`,
          priority: 2,
          attempts: 2,
        });
        deepCollectTriggered = true;
      }
    }

    return {
      cold,
      account: {
        puuid: acct.puuid,
        gameName: acct.gameName,
        tagLine: acct.tagLine,
        region: acct.region,
      },
      summoner: summonerRow ? {
        profileIconId: summonerRow.profileIconId,
        summonerLevel: summonerRow.summonerLevel,
        refreshedAt: summonerRow.refreshedAt,
      } : null,
      leagueEntries: leagueEntries.map((e) => ({
        queueType: e.queueType,
        tier: e.tier, rank: e.rank,
        leaguePoints: e.leaguePoints,
        wins: e.wins, losses: e.losses,
        winrate: (e.wins + e.losses) > 0
          ? Math.round((e.wins / (e.wins + e.losses)) * 1000) / 10
          : 0,
      })),
      matchesAvailable: matchCount,
      deepCollectTriggered,
    };
  });

  // ---- GET /api/summoner/:puuid/matches?count=20 ------------------------
  app.get<{ Params: PuuidParams; Querystring: { count?: string } }>(
    '/api/summoner/:puuid/matches',
    async (req, _reply) => {
      const count = Math.min(50, Math.max(1, Number(req.query.count ?? 20)));
      const puuid = req.params.puuid;

      const rows = await db
        .select({
          mp: schema.matchParticipants,
          m:  schema.matches,
        })
        .from(schema.matchParticipants)
        .innerJoin(schema.matches, eq(schema.matches.matchId, schema.matchParticipants.matchId))
        .where(eq(schema.matchParticipants.puuid, puuid))
        .orderBy(desc(schema.matches.gameCreation))
        .limit(count);

      // For each match include all 10 participants with full stats so the
      // frontend's match-card expand panel doesn't need a second round trip.
      const matchIds = rows.map((r) => r.m.matchId);
      const allMembers = matchIds.length === 0 ? [] : await db
        .select()
        .from(schema.matchParticipants)
        .where(inArray(schema.matchParticipants.matchId, matchIds));
      const byMatch = new Map<string, typeof allMembers>();
      for (const m of allMembers) {
        const arr = byMatch.get(m.matchId) ?? [];
        arr.push(m);
        byMatch.set(m.matchId, arr);
      }

      // Static runes map (perk id → icon path + tree key) for keystone +
      // full rune-page resolution. Cheap query; cached implicitly.
      const runeRows = await db.execute(sql`
        SELECT DISTINCT ON (id) id, rune_key, tree_key, icon_path
        FROM static_runes ORDER BY id, patch DESC
      `);
      const runeMetaById = new Map<number, { iconPath: string; treeKey: string; runeKey: string }>();
      for (const r of runeRows as unknown as Array<{ id: number; rune_key: string; tree_key: string; icon_path: string }>) {
        runeMetaById.set(r.id, { iconPath: r.icon_path, treeKey: r.tree_key, runeKey: r.rune_key });
      }
      const runeIconById = new Map(Array.from(runeMetaById.entries()).map(([k, v]) => [k, v.iconPath]));

      // Resolve gameName/tagLine for every participant puuid (one query).
      const allPuuids = Array.from(new Set(allMembers.map((m) => m.puuid)));
      const accountRows = allPuuids.length === 0 ? [] : await db
        .select({ puuid: schema.accounts.puuid, gameName: schema.accounts.gameName, tagLine: schema.accounts.tagLine })
        .from(schema.accounts)
        .where(inArray(schema.accounts.puuid, allPuuids));
      const nameByPuuid = new Map<string, { puuid: string; gameName: string; tagLine: string }>(
        accountRows.map((a) => [a.puuid, a]),
      );
      // Backfill from raw_participant — Riot match data includes
      // riotIdGameName / riotIdTagline per player, so names show up even
      // before BFS has imported the participant into our accounts table.
      for (const m of allMembers) {
        if (nameByPuuid.has(m.puuid)) continue;
        const raw = (m.rawParticipant ?? {}) as Record<string, unknown>;
        const gn = raw.riotIdGameName;
        const tl = raw.riotIdTagline;
        if (typeof gn === 'string' && gn) {
          nameByPuuid.set(m.puuid, { puuid: m.puuid, gameName: gn, tagLine: typeof tl === 'string' ? tl : '' });
        }
      }

      return {
        puuid,
        count: rows.length,
        matches: rows.map((r) => {
          const me = r.mp;
          const minutes = Math.max(1, r.m.gameDuration / 60);
          const all = byMatch.get(r.m.matchId) ?? [];
          const expanded = all.map((p) => {
            const acct = nameByPuuid.get(p.puuid);
            const rn = p.runes as { styles?: Array<{ style: number; selections: Array<{ perk: number }> }> } | null;
            const keystonePerk = rn?.styles?.[0]?.selections?.[0]?.perk;
            const subStyle = rn?.styles?.[1]?.style;
            return {
              puuid: p.puuid,
              gameName: acct?.gameName || '',
              tagLine: acct?.tagLine || '',
              slot: p.slot,
              championKey: p.championKey,
              championId: p.championId,
              lane: p.lane,
              team: p.team,
              isSelf: p.puuid === puuid,
              win: p.win,
              kills: p.kills, deaths: p.deaths, assists: p.assists,
              kp: p.kp,
              cs: p.cs,
              csPerMin: Math.round((p.cs / minutes) * 10) / 10,
              visionScore: p.visionScore,
              dmgToChampPerMin: Math.round(p.dmgToChampPerMin),
              items: p.items, spells: p.spells,
              keystoneId: keystonePerk ?? null,
              keystoneIcon: keystonePerk ? (runeIconById.get(keystonePerk) ?? null) : null,
              subStyleId: subStyle ?? null,
              aiScore: p.aiScoreCached,
              aiScoreLetter: p.aiScoreLetter,
            };
          }).sort((a, b) => {
            if (a.team !== b.team) return a.team === 'blue' ? -1 : 1;
            return (a.slot ?? 0) - (b.slot ?? 0);
          });

          return {
            matchId: r.m.matchId,
            patch: r.m.patch,
            queueId: r.m.queueId,
            gameCreation: r.m.gameCreation,
            gameDuration: r.m.gameDuration,
            bluewin: r.m.bluewin,
            self: {
              championKey: me.championKey,
              championId: me.championId,
              lane: me.lane,
              team: me.team,
              win: me.win,
              kills: me.kills, deaths: me.deaths, assists: me.assists,
              kp: me.kp,
              cs: me.cs,
              csPerMin: Math.round((me.cs / minutes) * 10) / 10,
              visionScore: me.visionScore,
              dmgToChampPerMin: Math.round(me.dmgToChampPerMin),
              items: me.items, spells: me.spells, runes: me.runes,
              runesFull: (() => {
                const rn = me.runes as {
                  styles?: Array<{ style: number; selections: Array<{ perk: number }> }>;
                  statPerks?: { offense?: number; flex?: number; defense?: number };
                } | null;
                if (!rn?.styles) return null;
                return {
                  primaryStyle: rn.styles[0]?.style ?? null,
                  subStyle:     rn.styles[1]?.style ?? null,
                  perks: [
                    ...(rn.styles[0]?.selections ?? []),
                    ...(rn.styles[1]?.selections ?? []),
                  ].map((s) => ({ id: s.perk, ...(runeMetaById.get(s.perk) ?? { iconPath: null, treeKey: null, runeKey: null }) })),
                  statPerks: rn.statPerks ?? null,
                };
              })(),
              keystoneId: (me.runes as { styles?: Array<{ selections: Array<{ perk: number }> }> } | null)?.styles?.[0]?.selections?.[0]?.perk ?? null,
              keystoneIcon: (() => {
                const k = (me.runes as { styles?: Array<{ selections: Array<{ perk: number }> }> } | null)?.styles?.[0]?.selections?.[0]?.perk;
                return k ? (runeIconById.get(k) ?? null) : null;
              })(),
              subStyleId: (me.runes as { styles?: Array<{ style: number }> } | null)?.styles?.[1]?.style ?? null,
              aiScore: me.aiScoreCached,
              aiScoreLetter: me.aiScoreLetter,
              aiScoreVersion: me.aiScoreAlgoVersion,
            },
            participants: expanded,
          };
        }),
      };
    },
  );

  // ---- POST /api/summoner/:puuid/refresh (F-213) ------------------------
  // Two-layer rate limit:
  //   - per-PUUID cooldown (REFRESH_COOLDOWN_MS) — prevents spamming one summoner
  //   - per-IP cap via @fastify/rate-limit config — prevents one user from
  //     scraping fresh data on hundreds of different PUUIDs
  app.post<{ Params: PuuidParams }>('/api/summoner/:puuid/refresh', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (req, reply) => {
    const puuid = req.params.puuid;
    const cooldownKey = `cd:refresh:${puuid}`;
    const exists = await redis.get(cooldownKey);
    if (exists) {
      const remaining = Math.max(0, Number(exists) - Date.now());
      return reply.status(429).send({
        error: 'cooldown', cooldownRemainingMs: remaining,
        message: `${Math.ceil(remaining / 1000)}초 후 다시 시도해주세요`,
      });
    }
    const acct = await db.query.accounts.findFirst({ where: eq(schema.accounts.puuid, puuid) });
    if (!acct) return reply.status(404).send({ error: 'unknown puuid' });

    await redis.set(cooldownKey, String(Date.now() + REFRESH_COOLDOWN_MS), 'PX', REFRESH_COOLDOWN_MS);

    // Enqueue with USER_TRIGGERED priority — worker picks this up first.
    await puuidQueue.add('puuid', {
      puuid, region: acct.region, reason: 'refresh',
    }, {
      jobId: `refresh__${puuid}__${Date.now()}`,
      priority: 1,
      attempts: 3,
    });

    return { ok: true, queued: true, cooldownMs: REFRESH_COOLDOWN_MS };
  });

  // ---- POST /api/summoner/:puuid/deep-collect ---------------------------
  // Triggers paginated history fetch (up to ~500 ranked-solo matches).
  // Idempotent: refuses if a deep-collect job is already enqueued recently.
  // Per-IP rate limited harder than refresh — this is expensive.
  app.post<{ Params: PuuidParams; Querystring: { pages?: string } }>(
    '/api/summoner/:puuid/deep-collect',
    {
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const puuid = req.params.puuid;
      const pages = Math.min(10, Math.max(1, Number(req.query.pages ?? 5)));

      const acct = await db.query.accounts.findFirst({ where: eq(schema.accounts.puuid, puuid) });
      if (!acct) return reply.status(404).send({ error: 'unknown puuid' });

      // Dedupe: short Redis lock so rapid clicks don't double-enqueue.
      const lockKey = `lock:deep-collect:${puuid}`;
      const acquired = await redis.set(lockKey, '1', 'EX', 90, 'NX');
      if (!acquired) {
        return { ok: true, queued: false, message: 'already in progress' };
      }

      await puuidQueue.add('puuid', {
        puuid, region: acct.region, reason: 'deep-collect', deepPages: pages,
      }, {
        jobId: `deep__${puuid}__${Date.now()}`,
        priority: 2,    // between refresh (1) and bfs (3)
        attempts: 2,
      });

      // ETA assumes dev key (4 calls list + ~pages*100 detail calls @ 0.83/s).
      const etaSec = Math.round((4 + pages * 100 * 2) / 0.83);
      return { ok: true, queued: true, pages, estimatedSeconds: etaSec };
    },
  );

  // ---- GET /api/summoner/:puuid/rank-history ---------------------------
  // Last N days of daily league_entries snapshots. Drives the tier-
  // progression dots + LP trend chart on the summoner overview.
  app.get<{ Params: PuuidParams; Querystring: { days?: string; queue?: string } }>(
    '/api/summoner/:puuid/rank-history',
    async (req) => {
      const puuid = req.params.puuid;
      const days = Math.min(120, Math.max(1, Number(req.query.days ?? 30)));
      const queue = req.query.queue || 'RANKED_SOLO_5x5';

      const rows = await db.execute(sql`
        SELECT snapshot_date::text AS "snapshotDate",
               tier, rank, lp, wins, losses
        FROM player_rank_history
        WHERE puuid = ${puuid}
          AND queue_type = ${queue}
          AND snapshot_date >= CURRENT_DATE - ${days}::int
        ORDER BY snapshot_date ASC
      `);
      return { puuid, queue, days, history: rows };
    },
  );

  // ---- GET /api/summoner/:puuid/co-players ------------------------------
  // For the "함께 플레이한 소환사" sidebar widget. Counts how often each
  // other puuid showed up in the requester's last N solo-queue matches,
  // split by same-team vs opposing.
  app.get<{ Params: PuuidParams; Querystring: { count?: string } }>(
    '/api/summoner/:puuid/co-players',
    async (req) => {
      const puuid = req.params.puuid;
      const count = Math.min(50, Math.max(1, Number(req.query.count ?? 20)));

      const rows = await db.execute(sql`
        WITH my_matches AS (
          SELECT mp.match_id, mp.team AS my_team, mp.win AS my_win
          FROM match_participants mp
          JOIN matches m ON m.match_id = mp.match_id
          WHERE mp.puuid = ${puuid} AND m.queue_id = 420
          ORDER BY m.game_creation DESC
          LIMIT ${count}
        )
        SELECT
          op.puuid                                                    AS "puuid",
          (op.team = mm.my_team)                                      AS "sameTeam",
          COUNT(*)::int                                               AS games,
          COUNT(*) FILTER (WHERE op.win = mm.my_win)::int             AS shared_outcome
        FROM my_matches mm
        JOIN match_participants op ON op.match_id = mm.match_id
        WHERE op.puuid <> ${puuid}
        GROUP BY op.puuid, (op.team = mm.my_team)
      `);

      type Row = { puuid: string; sameTeam: boolean; games: number; shared_outcome: number };
      const list = rows as unknown as Row[];
      const puuids = Array.from(new Set(list.map((r) => r.puuid)));

      // Resolve names + summoner level/icon.
      const acctRows = puuids.length > 0 ? await db
        .select({ puuid: schema.accounts.puuid, gameName: schema.accounts.gameName, tagLine: schema.accounts.tagLine })
        .from(schema.accounts)
        .where(inArray(schema.accounts.puuid, puuids)) : [];
      const sumRows = puuids.length > 0 ? await db
        .select({ puuid: schema.summoners.puuid, profileIconId: schema.summoners.profileIconId })
        .from(schema.summoners)
        .where(inArray(schema.summoners.puuid, puuids)) : [];
      const acctMap = new Map(acctRows.map((r) => [r.puuid, r]));
      const sumMap = new Map(sumRows.map((r) => [r.puuid, r]));

      // Pull latest ranked-solo tier from raw_participant (always present in
      // recent matches), with fallback to league_entries.
      const leRows = puuids.length > 0 ? await db.execute(sql`
        SELECT DISTINCT ON (puuid) puuid, tier, rank
        FROM league_entries
        WHERE puuid = ANY(${puuids}::text[]) AND queue_type = 'RANKED_SOLO_5x5'
        ORDER BY puuid, refreshed_at DESC
      `) : [];
      const tierMap = new Map<string, { tier: string; rank: string }>();
      for (const r of leRows as unknown as Array<{ puuid: string; tier: string; rank: string }>) {
        tierMap.set(r.puuid, { tier: r.tier, rank: r.rank });
      }

      // Merge by puuid + sameTeam bucket. Frontend toggles between the two.
      type Entry = {
        puuid: string; gameName: string | null; tagLine: string | null;
        profileIconId: number | null;
        tier: string | null; rank: string | null;
        sameTeam: { games: number; wins: number };
        oppTeam:  { games: number; wins: number };
      };
      const merged = new Map<string, Entry>();
      for (const r of list) {
        const cur = merged.get(r.puuid) ?? {
          puuid: r.puuid,
          gameName: acctMap.get(r.puuid)?.gameName ?? null,
          tagLine: acctMap.get(r.puuid)?.tagLine ?? null,
          profileIconId: sumMap.get(r.puuid)?.profileIconId ?? null,
          tier: tierMap.get(r.puuid)?.tier ?? null,
          rank: tierMap.get(r.puuid)?.rank ?? null,
          sameTeam: { games: 0, wins: 0 },
          oppTeam:  { games: 0, wins: 0 },
        };
        const bucket = r.sameTeam ? cur.sameTeam : cur.oppTeam;
        bucket.games += r.games;
        // For same-team: shared_outcome == both win. For opp-team: shared_outcome == I won (they lost).
        // Track "my wins together" not "their wins" — more useful for "duo with X went well N times".
        if (r.sameTeam) bucket.wins += r.shared_outcome;
        merged.set(r.puuid, cur);
      }

      // Sort by total games desc within each bucket; take top 10 per bucket.
      const all = Array.from(merged.values());
      const sameTeam = all
        .filter((e) => e.sameTeam.games > 0)
        .sort((a, b) => b.sameTeam.games - a.sameTeam.games)
        .slice(0, 10);
      const oppTeam = all
        .filter((e) => e.oppTeam.games > 0)
        .sort((a, b) => b.oppTeam.games - a.oppTeam.games)
        .slice(0, 10);

      return { puuid, sampleMatches: count, sameTeam, oppTeam };
    },
  );

  // ---- GET /api/summoner/:puuid/match-count -----------------------------
  // Fast count for the deep-collect polling UI (no expensive joins).
  app.get<{ Params: PuuidParams }>('/api/summoner/:puuid/match-count', async (req) => {
    const puuid = req.params.puuid;
    const r = await db.execute(sql`SELECT COUNT(*)::int AS n FROM match_participants WHERE puuid = ${puuid}`);
    const count = Number((r as unknown as Array<{ n: number }>)[0]?.n ?? 0);
    return { puuid, count };
  });

  // ---- GET /api/summoner/suggest ----------------------------------------
  // Substring match on gameName with tier info for autocomplete. Limited to
  // accounts we've ingested (Riot has no fuzzy search API), so a query that
  // matches nothing in our DB falls back to "type 이름#태그 directly" in UI.
  // Prefix matches are surfaced above substring matches.
  app.get<{ Querystring: { q?: string; region?: string; limit?: string } }>(
    '/api/summoner/suggest',
    async (req) => {
      const q = (req.query.q ?? '').trim();
      if (q.length < 2) return { matches: [] };
      const region = req.query.region || 'kr';
      const limit = Math.min(Number(req.query.limit ?? 10) || 10, 20);

      const rows = await db.execute(sql`
        SELECT a.puuid,
               a.game_name AS "gameName",
               a.tag_line  AS "tagLine",
               a.region,
               le.tier, le.rank, le.league_points AS "lp"
        FROM accounts a
        LEFT JOIN LATERAL (
          SELECT tier, rank, league_points
          FROM league_entries
          WHERE puuid = a.puuid AND queue_type = 'RANKED_SOLO_5x5'
          ORDER BY refreshed_at DESC LIMIT 1
        ) le ON true
        WHERE a.region = ${region}
          AND a.game_name ILIKE ${'%' + q + '%'}
        ORDER BY
          CASE WHEN a.game_name ILIKE ${q + '%'} THEN 0 ELSE 1 END,
          CASE WHEN le.tier IS NULL THEN 1 ELSE 0 END,
          LENGTH(a.game_name),
          a.game_name
        LIMIT ${limit}
      `);
      return { matches: rows };
    },
  );
}
