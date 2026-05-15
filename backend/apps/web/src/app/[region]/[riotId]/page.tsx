import { notFound } from 'next/navigation';
import { apiGet, ApiError } from '@/lib/api';
import { ddragon } from '@/lib/ddragon';
import { parseRiotIdSlug, formatRiotId } from '@/lib/riot-id';
import type { SummonerSearchResponse, MatchListResponse } from '@/lib/api-types-summoner';
import { getDdragonVersion } from '@/lib/ddragon-version';
import { ChampionIcon } from '@/components/atoms/champion-icon';

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
    IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드',
    PLATINUM: '플래티넘', EMERALD: '에메랄드', DIAMOND: '다이아몬드',
    MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저',
  };
  return map[tier] ?? tier;
}

function queueKr(q: string) {
  if (q === 'RANKED_SOLO_5x5') return '솔로 랭크';
  if (q === 'RANKED_FLEX_SR') return '자유 5:5';
  return q;
}

export default async function SummonerPage({ params }: PageProps) {
  const { region, riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  if (!id) notFound();

  const slug = `${encodeURIComponent(id.gameName)}%23${encodeURIComponent(id.tagLine)}`;
  const summoner = await apiGet<SummonerSearchResponse>(
    `/api/summoner/${region}/${slug}`,
  ).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!summoner) notFound();

  const matches = await apiGet<MatchListResponse>(
    `/api/summoner/${summoner.account.puuid}/matches?count=20`,
  ).catch(() => null);

  const version = await getDdragonVersion();
  const profileIconUrl = summoner.summoner
    ? ddragon.profileIcon(summoner.summoner.profileIconId, version)
    : null;

  const solo = summoner.leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  const flex = summoner.leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR');

  return (
    <main className="page">
      <header className="card" style={{ display: 'flex', gap: 24, alignItems: 'center', padding: 24, marginBottom: 24 }}>
        {profileIconUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profileIconUrl} width={96} height={96} alt="" style={{ borderRadius: 8 }} />
        )}
        <div style={{ flex: 1 }}>
          <h1 className="page-title">
            {summoner.account.gameName}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 8, fontSize: 18 }}>
              #{summoner.account.tagLine}
            </span>
          </h1>
          <div className="page-subtitle">
            레벨 {summoner.summoner?.summonerLevel ?? '—'} · {region.toUpperCase()} · 매치 {summoner.matchesAvailable}개 수집됨
          </div>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[solo, flex].map((entry, i) => (
          <div key={i} className="card" style={{ padding: 20 }}>
            <div className="section-title">
              <span>{entry ? queueKr(entry.queueType) : (i === 0 ? '솔로 랭크' : '자유 5:5')}</span>
            </div>
            {entry ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
                  {tierKr(entry.tier)} {entry.rank} · {entry.leaguePoints} LP
                </div>
                <div className="text-tertiary" style={{ fontSize: 13 }}>
                  {entry.wins}승 {entry.losses}패 · 승률 {entry.winrate}%
                </div>
              </>
            ) : (
              <div className="text-tertiary">언랭</div>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div className="section-title" style={{ padding: 16 }}>
          <span>최근 매치</span>
          <span className="meta">{matches?.count ?? 0}개 표시</span>
        </div>
        {matches && matches.matches.length > 0 ? (
          <div>
            {matches.matches.map((m) => {
              const kda = m.deaths === 0 ? (m.kills + m.assists) : (m.kills + m.assists) / m.deaths;
              const minutes = Math.round(m.gameDuration / 60);
              return (
                <div
                  key={m.matchId}
                  className="match-card"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: 16,
                    padding: 16,
                    borderTop: '1px solid var(--border-subtle)',
                    borderLeft: `3px solid ${m.win ? 'var(--color-win)' : 'var(--color-loss)'}`,
                    alignItems: 'center',
                  }}
                >
                  <ChampionIcon championKey={m.championKey} size={48} version={version} />
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {m.win ? '승리' : '패배'} · {m.lane.toUpperCase()} · {minutes}분
                    </div>
                    <div className="text-tertiary" style={{ fontSize: 12 }}>
                      {m.kills}/{m.deaths}/{m.assists} (KDA {kda.toFixed(2)}) · CS {m.cs} · 시야 {m.visionScore} · 패치 {m.patch}
                    </div>
                  </div>
                  <div className="text-tertiary" style={{ fontSize: 11, textAlign: 'right' }}>
                    {new Date(m.gameCreation).toLocaleDateString('ko-KR')}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: 24, color: 'var(--text-tertiary)', textAlign: 'center' }}>
            {summoner.cold ? '데이터 수집 중입니다. 잠시 후 새로고침하세요.' : '매치 데이터가 없습니다.'}
          </div>
        )}
      </div>
    </main>
  );
}
