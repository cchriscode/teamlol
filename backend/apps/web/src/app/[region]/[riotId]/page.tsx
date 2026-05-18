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

function tierKr(tier: string) {
  const map: Record<string, string> = {
    IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
    PLATINUM: 'Platinum', EMERALD: 'Emerald', DIAMOND: 'Diamond',
    MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
  };
  return map[tier] ?? tier;
}
function tierClass(tier: string) {
  return 'tier-' + tier.toLowerCase();
}
function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}
function timeAgo(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  return `${d}일 전`;
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

  const matches = await apiGet<MatchListResponse>(`/api/summoner/${summoner.account.puuid}/matches?count=20`).catch(() => null);
  const coPlayers = await apiGet<{ sampleMatches: number; sameTeam: Parameters<typeof CoPlayersCard>[0]['sameTeam']; oppTeam: Parameters<typeof CoPlayersCard>[0]['oppTeam'] }>(
    `/api/summoner/${summoner.account.puuid}/co-players?count=20`,
  ).catch(() => null);
  const meta = await getChampionMeta();
  const version = await getDdragonVersion();
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

  // Top champions
  const champCounts: Record<string, { games: number; wins: number; key: string; name: string }> = {};
  recent.forEach((m) => {
    const k = m.self.championKey;
    if (!champCounts[k]) {
      champCounts[k] = { games: 0, wins: 0, key: k, name: meta.byKey.get(k)?.name ?? k };
    }
    champCounts[k].games += 1;
    if (m.self.win) champCounts[k].wins += 1;
  });
  const topChamps = Object.values(champCounts).sort((a, b) => b.games - a.games).slice(0, 5);

  return (
    <main className="page">
      <SummonerHeader summoner={summoner} region={region} riotId={riotId} tab="overview" />

      <div className="summoner-grid">
        <aside className="sidebar">
          <RankHistoryCard puuid={summoner.account.puuid} days={30} />

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
              <div className="text-tertiary uppercase" style={{ fontSize: 11, marginBottom: 8 }}>자주 가는 라인</div>
              {Object.entries(laneCounts).sort((a,b)=>b[1]-a[1]).map(([ln, n]) => (
                <div key={ln} className="stats-detail-row">
                  <span className="stats-detail-label">{laneKr(ln)}</span>
                  <span className="stats-detail-value">{n}게임 ({Math.round(n / recent.length * 100)}%)</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="section-title">자주 픽한 챔프 <span className="meta">최근 {recent.length}게임</span></div>
            <div>
              {topChamps.length === 0 ? (
                <div className="text-tertiary" style={{ padding: 8 }}>데이터 없음</div>
              ) : (
                topChamps.map((c) => {
                  const wr = c.games > 0 ? (c.wins / c.games) * 100 : 0;
                  return (
                    <div key={c.key} className="champ-list-row">
                      <ChampionIcon championKey={c.key} size={32} alt={c.name} />
                      <div className="champ-list-info">
                        <div className="champ-list-name">{c.name}</div>
                        <div className="text-tertiary" style={{ fontSize: 11 }}>
                          {c.games}게임 · {wr.toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

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
