import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ddragon } from '@/lib/ddragon';
import { getDdragonVersion } from '@/lib/ddragon-version';
import { slugFromRiotId } from '@/lib/riot-id';

export const revalidate = 600;

interface LeaderboardEntry {
  rank: number;
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  profileIconId: number | null;
  summonerLevel: number | null;
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
  { key: 'challenger',  label: '챌린저',     cls: 'tier-challenger' },
  { key: 'grandmaster', label: '그랜드마스터', cls: 'tier-grandmaster' },
  { key: 'master',      label: '마스터',     cls: 'tier-master' },
];

interface PageProps { searchParams: Promise<{ region?: string; tier?: string }>; }

export default async function LeaderboardPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const region = sp.region ?? 'kr';
  const tier = TIERS.find((t) => t.key === sp.tier)?.key ?? 'challenger';

  const [data, version] = await Promise.all([
    apiGet<LeaderboardResponse>(
      `/api/leaderboard/${region}?tier=${tier}&queue=RANKED_SOLO_5x5`,
      { next: { revalidate: 600 } },
    ).catch(() => null),
    getDdragonVersion(),
  ]);

  // LP cutoffs (per Riot tier rules)
  const cutoffs = data ? {
    challenger:  data.tier === 'CHALLENGER'  ? data.entries.at(-1)?.lp : null,
    grandmaster: data.tier === 'GRANDMASTER' ? data.entries.at(-1)?.lp : null,
    master:      data.tier === 'MASTER'      ? data.entries.at(-1)?.lp : null,
  } : { challenger: null, grandmaster: null, master: null };

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">랭킹 · {region.toUpperCase()}</h1>
          <div className="page-subtitle">
            {data ? `${new Date(data.generatedAt).toLocaleString('ko-KR')} 기준` : '데이터 없음'}
          </div>
        </div>
        <div className="patch-info">
          시즌 <span className="patch-num">2026 S1</span>
        </div>
      </header>

      {data && (
        <section className="cutoff-cards" aria-label="티어 진입 LP 컷오프">
          <div className="card cutoff-card">
            <div>
              <div className="cutoff-card-tier tier-challenger">챌린저</div>
              <div className="cutoff-card-meta">상위 300명</div>
            </div>
            <div className="cutoff-card-lp">
              {tier === 'challenger' && cutoffs.challenger != null ? `${cutoffs.challenger} LP` : '—'}
            </div>
          </div>
          <div className="card cutoff-card">
            <div>
              <div className="cutoff-card-tier tier-grandmaster">그랜드마스터</div>
              <div className="cutoff-card-meta">상위 700명</div>
            </div>
            <div className="cutoff-card-lp">
              {tier === 'grandmaster' && cutoffs.grandmaster != null ? `${cutoffs.grandmaster} LP` : '—'}
            </div>
          </div>
          <div className="card cutoff-card">
            <div>
              <div className="cutoff-card-tier tier-master">마스터</div>
              <div className="cutoff-card-meta">상위 약 1.2%</div>
            </div>
            <div className="cutoff-card-lp">
              {tier === 'master' && cutoffs.master != null ? `${cutoffs.master} LP` : '—'}
            </div>
          </div>
        </section>
      )}

      <div className="filters" role="group" aria-label="랭킹 필터">
        <div className="filter-row">
          <span className="filter-label">큐</span>
          <span className="filter-chip active">솔로랭크</span>
        </div>
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
          <span className="filter-meta">{data ? `총 ${data.count}명` : ''}</span>
        </div>
      </div>

      <div className="data-table">
        <div className="data-table-header leaderboard-grid">
          <div>순위</div>
          <div className="change-cell">변동</div>
          <div>닉네임</div>
          <div>티어</div>
          <div className="text-right">LP</div>
          <div className="text-right">승/패</div>
          <div className="text-right winrate-col">승률</div>
          <div className="text-right">스트릭</div>
        </div>

        {!data || data.entries.length === 0 ? (
          <div className="table-footer">데이터를 불러올 수 없습니다.</div>
        ) : (
          data.entries.map((e) => {
            const hasAccount = e.gameName && e.tagLine;
            const tierClass = ({ CHALLENGER: 'tier-challenger', GRANDMASTER: 'tier-grandmaster', MASTER: 'tier-master' } as Record<string, string>)[e.tier] ?? '';
            const tierKr = ({ CHALLENGER: 'Challenger', GRANDMASTER: 'Grandmaster', MASTER: 'Master' } as Record<string, string>)[e.tier] ?? e.tier;
            const profileUrl = ddragon.profileIcon(e.profileIconId ?? 29, version);
            const inner = (
              <>
                <div className="rank-cell">{e.rank}</div>
                <div className="change-same change-cell" aria-label="변동 없음">━</div>
                <div className="champ-cell">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="profile-icon-img" src={profileUrl} width={32} height={32} alt="" />
                  <div>
                    <div className="champ-cell-name">
                      {hasAccount ? e.gameName : `#${e.puuid.slice(0, 8)}`}
                      {hasAccount && <span className="text-tertiary"> #{e.tagLine}</span>}
                    </div>
                  </div>
                </div>
                <div><span className={`tier-badge ${tierClass}`}>{tierKr}</span></div>
                <div className="stat-cell primary">{e.lp.toLocaleString('ko-KR')}</div>
                <div className="stat-cell text-right">{e.wins}승 {e.losses}패</div>
                <div className="stat-cell text-right">{e.winrate.toFixed(1)}%</div>
                <div className="stat-cell text-right">
                  {e.hotStreak && <span className="tier-badge tier-emerald">🔥 연승</span>}
                  {e.freshBlood && <span className="tier-badge tier-platinum">신규</span>}
                  {!e.hotStreak && !e.freshBlood && <span className="text-tertiary">—</span>}
                </div>
              </>
            );

            if (hasAccount) {
              return (
                <Link
                  key={e.puuid}
                  href={`/${region}/${slugFromRiotId({ gameName: e.gameName!, tagLine: e.tagLine! })}`}
                  className="data-table-row leaderboard-grid leaderboard-row"
                >
                  {inner}
                </Link>
              );
            }
            return (
              <div key={e.puuid} className="data-table-row leaderboard-grid leaderboard-row">
                {inner}
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
