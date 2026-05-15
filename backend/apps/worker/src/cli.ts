// CLI entry. Run via `pnpm --filter @lol-tracker/worker cli <command>`.
//
// Commands:
//   seed [region]          — enqueue Challenger+GM PUUIDs (default kr)
//   seed-master [region]   — also include Master league
//   refresh <riot-id>      — single-user refresh, e.g. "Hide on bush#KR1"

import { logger } from './logger.js';
import { env } from './env.js';
import { Region, parseRiotId, REGION_TO_REGIONAL } from '@lol-tracker/shared';
import { regionalFor } from '@lol-tracker/riot';
import { riot } from './riot-client.js';
import { seedFromHighElo } from './seed/challenger-bfs.js';
import { enqueuePuuid, closeAllQueues } from './queues.js';
import { redis } from './redis.js';
import { aggregateTier } from './aggregators/tier.js';
import { aggregateMatchups } from './aggregators/matchup.js';
import { aggregateSynergies } from './aggregators/synergy.js';
import { aggregateBotDuos } from './aggregators/bot-duo.js';
import { aggregateCopick } from './aggregators/copick.js';
import { syncStaticData } from './aggregators/static-data.js';
import { snapshotStatus, formatStatus } from './status.js';

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd) {
    console.error('usage: cli <command> [args...]');
    console.error('  seed [region]            — enqueue Challenger+GM PUUIDs');
    console.error('  seed-master [region]     — also include Master');
    console.error('  refresh "name#tag" [r]   — single user refresh');
    console.error('  agg-tier|matchup|synergy|bot-duo|copick [bracket]');
    console.error('  agg-all [bracket]        — run every aggregator');
    console.error('  backfill [limit]         — fetch account/summoner/league/mastery for missing accounts');
    console.error('  backfill-ai-scores       — recompute AI Scores for matches with NULL cache');
    console.error('  status                   — one-shot progress snapshot');
    console.error('  watch [intervalSec]      — live status (default 5s, Ctrl+C to exit)');
    process.exit(1);
  }

  try {
    switch (cmd) {
      case 'seed': {
        const region = (args[0] ?? env.SEED_REGION) as Region;
        const limit = env.RIOT_KEY_TIER === 'dev' ? 50 : undefined;
        const n = await seedFromHighElo({ region, limit });
        logger.info({ enqueued: n, region }, 'seed complete');
        break;
      }
      case 'enqueue-missing-ranks': {
        // For every puuid in match_participants without a league_entries row
        // (or no accounts row), enqueue a rank-only puuid job. Runs once;
        // safe to re-run.
        const { db, sql: dbsql } = await import('@lol-tracker/db');
        const rows = await db.execute(dbsql`
          SELECT DISTINCT mp.puuid, m.region
          FROM match_participants mp
          JOIN matches m ON m.match_id = mp.match_id
          LEFT JOIN league_entries le
            ON le.puuid = mp.puuid AND le.queue_type = 'RANKED_SOLO_5x5'
          WHERE le.puuid IS NULL
        `) as unknown as Array<{ puuid: string; region: string }>;
        let n = 0;
        for (const r of rows) {
          await enqueuePuuid({ puuid: r.puuid, region: r.region as Region, reason: 'rank-only', skipMatchIds: true });
          n++;
        }
        logger.info({ enqueued: n }, 'enqueue-missing-ranks done');
        break;
      }
      case 'reseed-patch': {
        // Re-enqueue every puuid that already has a match in the given patch.
        // Used after enabling MATCH_MIN_TIME_SEC to bootstrap from current
        // patch participants (skipping irrelevant pre-patch puuids).
        const patch = args[0];
        if (!patch) { console.error('usage: reseed-patch <patch>  e.g. 16.10'); process.exit(1); }
        const { db, sql: dbsql } = await import('@lol-tracker/db');
        const rows = await db.execute(dbsql`
          SELECT DISTINCT mp.puuid, m.region
          FROM match_participants mp
          JOIN matches m ON m.match_id = mp.match_id
          WHERE m.patch = ${patch}
        `) as unknown as Array<{ puuid: string; region: string }>;
        let n = 0;
        for (const r of rows) {
          await enqueuePuuid({ puuid: r.puuid, region: r.region as Region, reason: 'bfs' });
          n++;
        }
        logger.info({ enqueued: n, patch }, 'reseed complete');
        break;
      }
      case 'seed-master': {
        const region = (args[0] ?? env.SEED_REGION) as Region;
        const limit = env.RIOT_KEY_TIER === 'dev' ? 50 : undefined;
        const n = await seedFromHighElo({ region, includeMaster: true, limit });
        logger.info({ enqueued: n, region }, 'seed-master complete');
        break;
      }
      case 'agg-tier': {
        // Writes all 5 brackets (chal/gm+/master+/diamond+/emerald+) in one pass.
        const r = await aggregateTier();
        logger.info(r, 'agg-tier complete'); break;
      }
      case 'backfill-leagues': case 'backfill-accounts': case 'backfill': {
        // Per-puuid: fetch Riot ID + summoner profile + league entries + mastery.
        // Rate-limited by the riot client. ~4 calls per puuid.
        const { db, schema, sql: dbsql } = await import('@lol-tracker/db');
        const { upsertLeagueEntries, upsertAccountFull, upsertSummonerProfile, upsertChampionMasteries } = await import('./persist/match.js');
        const limit = Number(args[0]) || 0;
        const rows = await db.execute(dbsql`
          SELECT a.puuid, a.region, a.game_name AS "gameName",
                 (s.puuid IS NULL) AS "needSummoner",
                 (le.puuid IS NULL) AS "needLeague",
                 (cm.puuid IS NULL) AS "needMastery"
          FROM accounts a
          LEFT JOIN summoners s ON s.puuid = a.puuid
          LEFT JOIN league_entries le ON le.puuid = a.puuid
          LEFT JOIN champion_masteries cm ON cm.puuid = a.puuid
          WHERE a.game_name = '' OR s.puuid IS NULL OR le.puuid IS NULL OR cm.puuid IS NULL
          ${limit > 0 ? dbsql`LIMIT ${limit}` : dbsql``}
        `);
        const todo = rows as unknown as Array<{ puuid: string; region: string; gameName: string; needSummoner: boolean; needLeague: boolean; needMastery: boolean }>;
        logger.info({ todo: todo.length }, 'backfill starting');
        let done = 0, namesFilled = 0, profilesFilled = 0, leaguesFilled = 0, masteriesFilled = 0, errors = 0;
        for (const row of todo) {
          try {
            if (!row.gameName) {
              const acct = await riot.account.byPuuid(regionalFor(row.region as Region), row.puuid);
              await upsertAccountFull(row.puuid, row.region, acct.gameName, acct.tagLine);
              namesFilled += 1;
            }
            if (row.needSummoner) {
              const summ = await riot.summoner.byPuuid(row.region as Region, row.puuid);
              await upsertSummonerProfile(row.puuid, row.region, summ);
              profilesFilled += 1;
            }
            if (row.needLeague) {
              const dtos = await riot.league.entriesByPuuid(row.region as Region, row.puuid);
              if (dtos.length > 0) { await upsertLeagueEntries(row.puuid, dtos); leaguesFilled += 1; }
            }
            if (row.needMastery) {
              const masteries = await riot.mastery.byPuuid(row.region as Region, row.puuid);
              if (masteries.length > 0) { await upsertChampionMasteries(row.puuid, masteries.slice(0, 10)); masteriesFilled += 1; }
            }
            done += 1;
            if (done % 50 === 0) logger.info({ done, namesFilled, profilesFilled, leaguesFilled, masteriesFilled, errors, todo: todo.length }, 'progress');
          } catch (e) {
            errors += 1;
            const err = e as { status?: number; message?: string };
            // Track error categories for diagnosis. 404s on specific endpoints are
            // expected for unranked / no-mastery players — not real failures.
            if (errors <= 5 || errors % 50 === 0) {
              logger.warn({ status: err.status, msg: err.message?.slice(0, 200), puuid: row.puuid.slice(0, 8) }, 'backfill error');
            }
            // Soft cap: only abort if a quarter of recent attempts are failing
            // (transient network/429 spikes shouldn't kill an 8-hour job).
            if (errors > 200 && errors / done > 0.25) {
              logger.error({ errors, done }, 'error rate too high, aborting');
              break;
            }
          }
        }
        logger.info({ done, namesFilled, profilesFilled, leaguesFilled, masteriesFilled, errors }, 'backfill complete');
        void schema;
        break;
      }
      case 'agg-matchup': {
        const r = await aggregateMatchups();
        logger.info(r, 'agg-matchup complete'); break;
      }
      case 'agg-synergy': {
        const r = await aggregateSynergies();
        logger.info(r, 'agg-synergy complete'); break;
      }
      case 'agg-bot-duo': {
        const r = await aggregateBotDuos();
        logger.info(r, 'agg-bot-duo complete'); break;
      }
      case 'agg-copick': {
        const r = await aggregateCopick();
        logger.info(r, 'agg-copick complete'); break;
      }
      case 'status': {
        const snap = await snapshotStatus();
        // eslint-disable-next-line no-console
        console.log(formatStatus(snap));
        break;
      }
      case 'watch': {
        const interval = (Number(args[0]) || 5) * 1000;
        // eslint-disable-next-line no-console
        const print = () => snapshotStatus().then((s) => {
          process.stdout.write('\x1Bc');     // clear screen
          process.stdout.write(formatStatus(s) + '\n');
          process.stdout.write(`\n  (${interval / 1000}초마다 갱신, Ctrl+C로 종료)\n`);
        }).catch((e) => console.error('snapshot failed:', e.message));
        await print();
        const t = setInterval(print, interval);
        await new Promise<void>((resolve) => {
          process.on('SIGINT', () => { clearInterval(t); resolve(); });
        });
        break;
      }
      case 'backfill-ai-scores': {
        // Recompute AI Scores for participants with NULL cached score.
        // Pure DB op, no Riot calls — fast even for large backlogs.
        const { db, schema, sql: dbsql } = await import('@lol-tracker/db');
        const { computeAIScore, teamTotalsFrom } = await import('./ai-score/engine.js');
        const { eq } = await import('drizzle-orm');

        // Find candidate match_ids (those with at least one NULL score).
        const matchRows = await db.execute(dbsql`
          SELECT DISTINCT mp.match_id, m.game_duration
          FROM match_participants mp
          JOIN matches m ON m.match_id = mp.match_id
          WHERE mp.ai_score_cached IS NULL
        `);
        const matches = matchRows as unknown as Array<{ match_id: string; game_duration: number }>;
        logger.info({ matches: matches.length }, 'ai-score backfill starting');
        let scored = 0, errors = 0;
        for (const m of matches) {
          try {
            const parts = await db.select().from(schema.matchParticipants)
              .where(eq(schema.matchParticipants.matchId, m.match_id));
            if (parts.length === 0) continue;
            // Map DB row → ParsedParticipant-like shape the engine expects.
            const mapped = parts.map((p) => ({
              matchId: p.matchId, puuid: p.puuid, slot: p.slot,
              team: p.team as 'blue' | 'red',
              lane: p.lane as 'top' | 'jungle' | 'mid' | 'adc' | 'support' | null,
              role: p.role, championId: p.championId, championKey: p.championKey,
              win: p.win,
              kills: p.kills, deaths: p.deaths, assists: p.assists, kp: p.kp,
              cs: p.cs, csAt14: p.csAt14, csDiffAt14: p.csDiffAt14,
              goldPerMin: p.goldPerMin, xpPerMin: p.xpPerMin,
              dmgToChampPerMin: p.dmgToChampPerMin, dmgToObj: p.dmgToObj,
              damageTakenPerMin: p.damageTakenPerMin, dmgMitigatedPerMin: p.dmgMitigatedPerMin ?? 0,
              visionScore: p.visionScore, wardsPlaced: p.wardsPlaced, wardsKilled: p.wardsKilled,
              timeDeadPct: p.timeDeadPct,
              soloKills: p.soloKills, multiKills: p.multiKills,
              items: p.items as number[], spells: p.spells as number[], runes: p.runes,
              rawParticipant: p.rawParticipant,
            }));
            const totals = teamTotalsFrom(mapped);
            for (const part of mapped) {
              const r = computeAIScore(part, totals, m.game_duration);
              if (!r) continue;
              await db.update(schema.matchParticipants).set({
                aiScoreCached: r.score,
                aiScoreLetter: r.letter,
                aiScoreAlgoVersion: r.algoVersion,
              }).where(dbsql`match_id = ${part.matchId} AND puuid = ${part.puuid}`);
            }
            scored += 1;
            if (scored % 200 === 0) logger.info({ scored, errors, total: matches.length }, 'progress');
          } catch (e) {
            errors += 1;
            if (errors > 50) { logger.error('too many errors, aborting'); break; }
          }
        }
        logger.info({ scored, errors }, 'ai-score backfill complete');
        break;
      }
      case 'agg-all': {
        // All aggregators write all 5 brackets in one pass.
        for (const fn of [aggregateTier, aggregateMatchups, aggregateSynergies, aggregateBotDuos, aggregateCopick]) {
          const r = await fn();
          logger.info(r, `${fn.name} complete`);
        }
        break;
      }
      case 'sync-static': {
        const r = await syncStaticData();
        logger.info(r, 'static sync complete');
        break;
      }
      case 'refresh': {
        const riotIdStr = args[0];
        if (!riotIdStr) throw new Error('refresh requires "name#tag"');
        const id = parseRiotId(riotIdStr);
        if (!id) throw new Error('invalid riot id, expected name#tag');
        const region = (args[1] ?? env.SEED_REGION) as Region;
        const regional = REGION_TO_REGIONAL[region];
        const acct = await riot.account.byRiotId(regional, id.gameName, id.tagLine);
        await enqueuePuuid({ puuid: acct.puuid, region, reason: 'refresh' });
        logger.info({ puuid: acct.puuid, region }, 'refresh enqueued');
        break;
      }
      default:
        throw new Error(`unknown command: ${cmd}`);
    }
  } finally {
    await closeAllQueues();
    await redis.quit();
  }
}

main().then(() => process.exit(0)).catch((err) => {
  logger.error({ err: err?.message ?? err }, 'cli failed');
  process.exit(1);
});
