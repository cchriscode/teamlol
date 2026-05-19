import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet, ApiError } from '@/lib/api';
import { ddragon } from '@/lib/ddragon';
import { parseRiotIdSlug, formatRiotId } from '@/lib/riot-id';
import type { SummonerSearchResponse, MatchListResponse } from '@/lib/api-types-summoner';
import { getDdragonVersion } from '@/lib/ddragon-version';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { getChampionMeta } from '@/lib/champion-meta';
import { SummonerHeader } from './summoner-header';
import { MatchListClient } from './match-list-client';
import { CoPlayersCard } from './co-players';
import { RankHistoryCard } from './rank-history';
import { AIPredictionBadges } from './ai-prediction';
import { SeasonChampList } from './season-champ-list';
import type { RankPoint } from './rank-history';
import { laneKr } from '@/lib/display';

interface PageProps {
  params: Promise<{ region: string; riotId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  return {
    title: id ? `${formatRiotId(id)} — TeamLOL` : 'TeamLOL',
  };
}

export default async function SummonerPage({ params }: PageProps) {
  const { region, riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  if (!id) notFound();

  const slug = `${encodeURIComponent(id.gameName)}%23${encodeURIComponent(id.tagLine)}`;
  const summoner = await apiGet<SummonerSearchResponse>(`/api/summoner/${region}/${slug}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!summoner) notFound();

  // Fan out all summoner-page reads in parallel — they're independent given
  // the puuid above. Previously these ran sequentially (~6× round-trip cost).
  const [matches, coPlayers, seasonChamps, rankHistory, meta, version] = await Promise.all([
    apiGet<MatchListResponse>(`/api/summoner/${summoner.account.puuid}/matches?count=20`).catch(() => null),
    apiGet<{ sampleMatches: number; sameTeam: Parameters<typeof CoPlayersCard>[0]['sameTeam']; oppTeam: Parameters<typeof CoPlayersCard>[0]['oppTeam'] }>(
      `/api/summoner/${summoner.account.puuid}/co-players?count=20`,
    ).catch(() => null),
    apiGet<{ rows: Array<{ championId: number; championKey: string; lane: string; games: number; wins: number; avgKda: number; winrate: number }> }>(
      `/api/summoner/${summoner.account.puuid}/champion-stats?minGames=1`,
    ).catch(() => null),
    apiGet<{ history: RankPoint[] }>(`/api/summoner/${summoner.account.puuid}/rank-history?days=30`).catch(() => null),
    getChampionMeta(),
    getDdragonVersion(),
  ]);
  const profileIconUrl = summoner.summoner ? ddragon.profileIcon(summoner.summoner.profileIconId, version) : null;

  const solo = summoner.leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  const flex = summoner.leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR');

  // Recent 20 game stats
  const recent = matches?.matches ?? [];
  const wins = recent.filter((m) => m.self.win).length;
  const losses = recent.length - wins;
  const wrPct = recent.length > 0 ? (wins / recent.length) * 100 : 0;
  const ringCirc = 2 * Math.PI * 32;
  const ringOffset = ringCirc * (1 - wrPct / 100);

  const totalK = recent.reduce((s, m) => s + m.self.kills, 0);
  const totalD = recent.reduce((s, m) => s + m.self.deaths, 0);
  const totalA = recent.reduce((s, m) => s + m.self.assists, 0);
  const avgKda = totalD === 0 ? totalK + totalA : (totalK + totalA) / totalD;
  const avgKp = recent.length > 0
    ? Math.round(recent.reduce((s, m) => s + (m.self.kp ?? 0), 0) / recent.length * 100)
    : 0;

  // Lane distribution
  const laneCounts: Record<string, number> = {};
  recent.forEach((m) => { laneCounts[m.self.lane] = (laneCounts[m.self.lane] ?? 0) + 1; });

  // Season-wide champion stats (collapses lane splits into one row per
  // championId; sorted by games desc). Falls back to recent-20 aggregation
  // if the season endpoint returned nothing yet.
  type SeasonChamp = { championId: number; championKey: string; games: number; wins: number; avgKda: number };
  const byChamp = new Map<number, SeasonChamp>();
  for (const r of (seasonChamps?.rows ?? [])) {
    const cur = byChamp.get(r.championId) ?? { championId: r.championId, championKey: r.championKey, games: 0, wins: 0, avgKda: 0 };
    cur.games += r.games;
    cur.wins += r.wins;
    cur.avgKda += r.avgKda * r.games;       // weight by games for accurate merge
    byChamp.set(r.championId, cur);
  }
  const seasonTop = Array.from(byChamp.values())
    .map((c) => ({ ...c, avgKda: c.games > 0 ? c.avgKda / c.games : 0 }))
    .sort((a, b) => b.games - a.games);

  return (
    <main className="page">
      <SummonerHeader summoner={summoner} region={region} riotId={riotId} tab="overview" version={version} />

      <div className="summoner-grid">
        <aside className="sidebar">
          <RankHistoryCard history={rankHistory?.history ?? []} days={30} />

          <div className="card stats-summary">
            <div className="section-title">최근 {recent.length}게임</div>
            <div className="winrate-ring-wrap">
              <div className="winrate-ring">
                <svg width="80" height="80" viewBox="0 0 80 80" aria-label={`승률 ${wrPct.toFixed(0)}%`}>
                  <circle className="winrate-ring-track" cx="40" cy="40" r="32" />
                  <circle className="winrate-ring-progress" cx="40" cy="40" r="32"
                          strokeDasharray={ringCirc.toFixed(2)} strokeDashoffset={ringOffset.toFixed(2)} />
                </svg>
                <div className="winrate-ring-text">{wrPct.toFixed(0)}%</div>
              </div>
              <div>
                <div className="stats-detail-row">
                  <span className="stats-detail-label">승/패</span>
                  <span className="stats-detail-value">{wins}W {losses}L</span>
                </div>
                <div className="stats-detail-row">
                  <span className="stats-detail-label">평균 KDA</span>
                  <span className="stats-detail-value">{avgKda.toFixed(2)} : 1</span>
                </div>
                <div className="stats-detail-row">
                  <span className="stats-detail-label">킬관여</span>
                  <span className="stats-detail-value">{avgKp}%</span>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, marginTop: 'var(--space-3)' }}>
              <div className="text-tertiary uppercase" style={{ fontSize: 11, marginBottom: 8 }}>포지션 분포</div>
              {(() => {
                const lanes: Array<'top' | 'jungle' | 'mid' | 'adc' | 'support'> = ['top','jungle','mid','adc','support'];
                const maxN = Math.max(1, ...Object.values(laneCounts));
                // Per-lane win/loss split for the stacked bar.
                const winByLane: Record<string, number> = {};
                recent.forEach((m) => {
                  if (m.self.win) winByLane[m.self.lane] = (winByLane[m.self.lane] ?? 0) + 1;
                });
                return (
                  <div className="lane-bar-grid">
                    {lanes.map((ln) => {
                      const n = laneCounts[ln] ?? 0;
                      const w = winByLane[ln] ?? 0;
                      const heightPct = (n / maxN) * 100;
                      const winPct = n > 0 ? (w / n) * 100 : 0;
                      return (
                        <div key={ln} className="lane-bar-col" title={`${laneKr(ln)} ${n}게임 (${w}승 ${n - w}패)`}>
                          <div className="lane-bar-track">
                            <div className="lane-bar-fill" style={{ height: `${heightPct}%` }}>
                              <div className="lane-bar-win" style={{ height: `${winPct}%` }} />
                            </div>
                          </div>
                          <div className="lane-bar-label">{laneKr(ln)}</div>
                          <div className="lane-bar-count">{n > 0 ? `${n}` : '—'}</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          <SeasonChampList champs={seasonTop} championNameByKey={Object.fromEntries(Array.from(meta.byKey.entries()).map(([k, v]) => [k, v.name]))} region={region} riotId={riotId} />


          {coPlayers && (
            <CoPlayersCard
              sameTeam={coPlayers.sameTeam}
              oppTeam={coPlayers.oppTeam}
              region={region}
              version={version}
              sampleMatches={coPlayers.sampleMatches}
            />
          )}
        </aside>

        <div className="match-list">
          <AIPredictionBadges
            matches={recent}
            selfPuuid={summoner.account.puuid}
            currentTier={solo?.tier}
            currentRank={solo?.rank}
          />
          <MatchListClient
            matches={recent}
            selfPuuid={summoner.account.puuid}
            version={version}
            championNameByKey={Object.fromEntries(Array.from(meta.byKey.entries()).map(([k, v]) => [k, v.name]))}
            region={region}
            cold={summoner.cold}
          />
        </div>
      </div>
    </main>
  );
}
