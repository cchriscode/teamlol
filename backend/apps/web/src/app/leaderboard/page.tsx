import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { slugFromRiotId } from '@/lib/riot-id';

export const revalidate = 600;

interface LeaderboardEntry {
  rank: number;
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  tier: string;
  division: string;
  lp: number;
  wins: number;
  losses: number;
  winrate: number;
  hotStreak?: boolean;
  freshBlood?: boolean;
}

interface LeaderboardResponse {
  region: string;
  queue: string;
  tier: string;
  leagueName: string;
  generatedAt: string;
  count: number;
  entries: LeaderboardEntry[];
}

const TIERS = [
  { key: 'challenger',  label: '챌린저' },
  { key: 'grandmaster', label: '그랜드마스터' },
  { key: 'master',      label: '마스터' },
];

function tierBadgeClass(tier: string) {
  return ({
    CHALLENGER: 'tier-badge tier-challenger',
    GRANDMASTER: 'tier-badge tier-grandmaster',
    MASTER: 'tier-badge tier-master',
  } as Record<string, string>)[tier] ?? 'tier-badge';
}

interface PageProps {
  searchParams: Promise<{ region?: string; tier?: string }>;
}

export default async function LeaderboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const region = sp.region ?? 'kr';
  const tier = TIERS.find((t) => t.key === sp.tier)?.key ?? 'challenger';

  const data = await apiGet<LeaderboardResponse>(
    `/api/leaderboard/${region}?tier=${tier}&queue=RANKED_SOLO_5x5`,
    { next: { revalidate: 600 } },
  ).catch(() => null);

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">랭킹</h1>
          <div className="page-subtitle">
            {data ? `${data.leagueName} · ${data.count}명 표시` : '데이터 없음'}
          </div>
        </div>
      </header>

      <div className="filters" role="group" aria-label="랭킹 필터">
        <div className="filter-row">
          <span className="filter-label">티어</span>
          {TIERS.map((t) => (
            <Link
              key={t.key}
              href={`/leaderboard?region=${region}&tier=${t.key}`}
              className={`filter-chip${tier === t.key ? ' active' : ''}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="data-table">
        <div
          className="data-table-header"
          style={{ display: 'grid', gridTemplateColumns: '60px 1fr 100px 100px 80px 120px', padding: 12, gap: 12 }}
        >
          <div>순위</div>
          <div>소환사</div>
          <div className="text-right">티어</div>
          <div className="text-right">LP</div>
          <div className="text-right">승률</div>
          <div className="text-right">전적</div>
        </div>
        {data && data.entries.length > 0 ? (
          data.entries.map((e) => {
            const hasAccount = e.gameName && e.tagLine;
            const Wrapper: React.ElementType = hasAccount ? Link : 'div';
            const wrapperProps = hasAccount
              ? { href: `/${region}/${slugFromRiotId({ gameName: e.gameName!, tagLine: e.tagLine! })}` }
              : {};
            return (
              <Wrapper
                key={e.puuid}
                {...wrapperProps}
                className="data-table-row"
                style={{ display: 'grid', gridTemplateColumns: '60px 1fr 100px 100px 80px 120px', padding: 12, gap: 12, alignItems: 'center' }}
              >
                <div className="rank-cell">{e.rank}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="fw-medium">{e.gameName ?? `#${e.puuid.slice(0, 8)}`}</span>
                  {e.tagLine && <span className="text-tertiary">#{e.tagLine}</span>}
                  {e.hotStreak && <span className="tier-badge" style={{ marginLeft: 4 }}>🔥</span>}
                </div>
                <div className="text-right"><span className={tierBadgeClass(e.tier)}>{e.tier}</span></div>
                <div className="text-right stat-cell primary">{e.lp.toLocaleString('ko-KR')} LP</div>
                <div className="text-right stat-cell">{e.winrate.toFixed(1)}%</div>
                <div className="text-right text-tertiary" style={{ fontSize: 12 }}>
                  {e.wins}승 {e.losses}패
                </div>
              </Wrapper>
            );
          })
        ) : (
          <div className="table-footer">
            데이터를 불러올 수 없습니다.
          </div>
        )}
      </div>
    </main>
  );
}
