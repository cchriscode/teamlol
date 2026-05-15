// Live status snapshot — used by `cli status` and `cli watch`.
//
// Reads DB counts + Redis queue depths + recent activity. Pure read-only.
// Output is plain ANSI text suitable for a terminal.

import { db, sql } from '@lol-tracker/db';
import { redis } from './redis.js';
import { QUEUE_NAMES } from '@lol-tracker/shared';

interface StatusSnapshot {
  ts: string;
  data: {
    matches: number;
    participants: number;
    timelines: number;
    accounts: number;
  };
  aggregates: {
    championStats: number;
    matchups: number;
    synergies: number;
    botDuos: number;
    copickProbs: number;
  };
  queues: {
    puuid: { wait: number; active: number; completed: number; failed: number };
    matchId: { wait: number; active: number; completed: number; failed: number };
  };
  recent: {
    lastIngestedAt: string | null;
    matchesLastHour: number;
    accountsLastHour: number;
  };
  pace: {
    matchesPerHour: number;
    etaTo1000Hours: number;
    etaTo10000Hours: number;
  };
  patchDistribution: Array<{ patch: string; n: number }>;
}

export async function snapshotStatus(): Promise<StatusSnapshot> {
  // ---- DB counts (parallel) -----------------------------------------------
  const [
    matchCount, participantCount, timelineCount, accountCount,
    cs, mu, syn, bd, cp,
    lastIngest, matchesLastHour, accountsLastHour, patchDist,
  ] = await Promise.all([
    countRows('matches'),
    countRows('match_participants'),
    countRows('match_timelines'),
    countRows('accounts'),
    countRows('champion_stats'),
    countRows('champion_matchups'),
    countRows('champion_synergies'),
    countRows('bot_duo_synergy'),
    countRows('copick_probs'),
    db.execute(sql`SELECT MAX(ingested_at) AS ts FROM matches`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM matches WHERE ingested_at > NOW() - INTERVAL '1 hour'`),
    db.execute(sql`SELECT COUNT(*)::int AS n FROM accounts WHERE discovered_at > NOW() - INTERVAL '1 hour'`),
    db.execute(sql`SELECT patch, COUNT(*)::int AS n FROM matches GROUP BY patch ORDER BY n DESC LIMIT 5`),
  ]);

  const lastTs = (lastIngest as unknown as Array<{ ts: string | null }>)[0]?.ts ?? null;
  const mlh = (matchesLastHour as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  const alh = (accountsLastHour as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  // ---- Redis queue depths -------------------------------------------------
  const [puuidWait, puuidPrio, puuidActive, puuidCompleted, puuidFailed,
         midWait, midPrio, midActive, midCompleted, midFailed] = await Promise.all([
    redis.llen(`bull:${QUEUE_NAMES.PUUID}:wait`),
    redis.zcard(`bull:${QUEUE_NAMES.PUUID}:prioritized`),
    redis.llen(`bull:${QUEUE_NAMES.PUUID}:active`),
    redis.zcard(`bull:${QUEUE_NAMES.PUUID}:completed`),
    redis.zcard(`bull:${QUEUE_NAMES.PUUID}:failed`),
    redis.llen(`bull:${QUEUE_NAMES.MATCH_ID}:wait`),
    redis.zcard(`bull:${QUEUE_NAMES.MATCH_ID}:prioritized`),
    redis.llen(`bull:${QUEUE_NAMES.MATCH_ID}:active`),
    redis.zcard(`bull:${QUEUE_NAMES.MATCH_ID}:completed`),
    redis.zcard(`bull:${QUEUE_NAMES.MATCH_ID}:failed`),
  ]);

  // ---- Pace + ETA ---------------------------------------------------------
  const matchesPerHour = mlh;
  const eta1000 = matchesPerHour > 0 ? (1000 - matchCount) / matchesPerHour : Infinity;
  const eta10000 = matchesPerHour > 0 ? (10000 - matchCount) / matchesPerHour : Infinity;

  return {
    ts: new Date().toISOString(),
    data: { matches: matchCount, participants: participantCount, timelines: timelineCount, accounts: accountCount },
    aggregates: {
      championStats: cs, matchups: mu, synergies: syn, botDuos: bd,
      copickProbs: cp,
    },
    queues: {
      puuid: { wait: puuidWait + puuidPrio, active: puuidActive, completed: puuidCompleted, failed: puuidFailed },
      matchId: { wait: midWait + midPrio, active: midActive, completed: midCompleted, failed: midFailed },
    },
    recent: { lastIngestedAt: lastTs, matchesLastHour: mlh, accountsLastHour: alh },
    pace: { matchesPerHour, etaTo1000Hours: eta1000, etaTo10000Hours: eta10000 },
    patchDistribution: patchDist as unknown as Array<{ patch: string; n: number }>,
  };
}

async function countRows(table: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${table}`));
  return Number((r as unknown as Array<{ n: number }>)[0]?.n ?? 0);
}

// ---- Formatter ------------------------------------------------------------
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', gray: '\x1b[90m',
};

export function formatStatus(s: StatusSnapshot): string {
  const lines: string[] = [];
  const pad = (label: string, w = 22) => label.padEnd(w, ' ');
  const num = (n: number) => n.toLocaleString('en-US').padStart(8, ' ');
  const since = (iso: string | null) => {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3600_000)}h ago`;
  };
  const eta = (h: number) => {
    if (!isFinite(h) || h <= 0) return C.dim + 'n/a' + C.reset;
    if (h < 1) return `${Math.round(h * 60)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}일`;
  };

  lines.push(C.bold + `LoL Tracker — Worker Status  ${C.dim}${s.ts}` + C.reset);
  lines.push('');
  lines.push(C.cyan + '◆ 원본 데이터' + C.reset);
  lines.push(`  ${pad('matches')}${num(s.data.matches)}  ${C.green}+${s.recent.matchesLastHour}/h${C.reset}  ${C.dim}최근: ${since(s.recent.lastIngestedAt)}${C.reset}`);
  lines.push(`  ${pad('match_participants')}${num(s.data.participants)}`);
  lines.push(`  ${pad('match_timelines')}${num(s.data.timelines)}`);
  lines.push(`  ${pad('accounts')}${num(s.data.accounts)}  ${C.green}+${s.recent.accountsLastHour}/h${C.reset}`);
  lines.push('');
  lines.push(C.cyan + '◆ 집계 테이블' + C.reset);
  lines.push(`  ${pad('champion_stats')}${num(s.aggregates.championStats)}`);
  lines.push(`  ${pad('champion_matchups')}${num(s.aggregates.matchups)}`);
  lines.push(`  ${pad('champion_synergies')}${num(s.aggregates.synergies)}`);
  lines.push(`  ${pad('bot_duo_synergy')}${num(s.aggregates.botDuos)}`);
  lines.push(`  ${pad('copick_probs')}${num(s.aggregates.copickProbs)}`);
  lines.push('');
  lines.push(C.cyan + '◆ 큐 (대기 / 처리중 / 완료 / 실패)' + C.reset);
  const q = s.queues;
  lines.push(`  ${pad('puuid')}${num(q.puuid.wait)} / ${q.puuid.active} / ${q.puuid.completed} / ${q.puuid.failed > 0 ? C.red + q.puuid.failed + C.reset : q.puuid.failed}`);
  lines.push(`  ${pad('match-id')}${num(q.matchId.wait)} / ${q.matchId.active} / ${q.matchId.completed} / ${q.matchId.failed > 0 ? C.red + q.matchId.failed + C.reset : q.matchId.failed}`);
  lines.push('');
  lines.push(C.cyan + '◆ 페이스 + ETA' + C.reset);
  const pace = s.pace.matchesPerHour;
  const paceColor = pace > 100 ? C.green : pace > 20 ? C.yellow : C.red;
  lines.push(`  ${pad('현재 페이스')}${paceColor}${pace}/h${C.reset}`);
  lines.push(`  ${pad('1,000 매치까지')}${eta(s.pace.etaTo1000Hours)}`);
  lines.push(`  ${pad('10,000 매치까지')}${eta(s.pace.etaTo10000Hours)}`);
  lines.push('');
  if (s.patchDistribution.length > 0) {
    lines.push(C.cyan + '◆ 패치 분포' + C.reset);
    for (const p of s.patchDistribution) {
      lines.push(`  ${pad('patch ' + p.patch)}${num(p.n)}`);
    }
  }
  return lines.join('\n');
}
