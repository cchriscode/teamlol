import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { getChampionMeta } from '@/lib/champion-meta';
import { buildPickData } from '@/app/pick/build-pick-data';
import { createTierEngine } from '@/lib/tier-engine';
import type { Lane, Bracket } from '@/lib/types';

export const revalidate = 600;

const LANES: Array<{ key: Lane | 'all'; label: string }> = [
  { key: 'all',     label: '전체'  },
  { key: 'top',     label: '탑'    },
  { key: 'jungle',  label: '정글'  },
  { key: 'mid',     label: '미드'  },
  { key: 'adc',     label: '원딜'  },
  { key: 'support', label: '서폿'  },
];

const BRACKETS: Array<{ key: Bracket; label: string }> = [
  { key: 'emerald+',   label: '에메랄드+'    },
  { key: 'diamond+',   label: '다이아몬드+'  },
  { key: 'master+',    label: '마스터+'      },
  { key: 'gm+',        label: '그랜드마스터+' },
  { key: 'challenger', label: '챌린저'       },
];

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

interface PageProps {
  searchParams: Promise<{ lane?: string; bracket?: string }>;
}

export default async function ChampionsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const lane: Lane | 'all' = LANES.find((l) => l.key === sp.lane)?.key ?? 'all';
  const bracket: Bracket = BRACKETS.find((b) => b.key === sp.bracket)?.key ?? 'diamond+';

  // Use the pick-recommend data endpoint (all-champion view with matchups +
  // tier_avg_wr) — tier-engine needs the full table to compute PBI properly.
  const [api, meta] = await Promise.all([
    apiGet<Parameters<typeof buildPickData>[0]>(
      `/api/pick-recommend/data?bracket=${encodeURIComponent(bracket)}`,
      { next: { revalidate: 600 } },
    ),
    getChampionMeta(),
  ]);

  const data = buildPickData(api, { byId: meta.byId, byKey: meta.byKey });
  // Attach laneAvgWr from API (tier-engine reads TIER_AVG_WR for PBI).
  (data as unknown as { TIER_AVG_WR: Record<string, number> }).TIER_AVG_WR = api.laneAvgWr ?? {};

  const engine = createTierEngine(data);
  const rows = lane === 'all'
    ? engine.fullTable({ minPickrate: 0.5 })
    : engine.tierTable(lane, { minPickrate: 0.5 });

  const totalSample = Object.values(data.TIER_DATA).reduce((acc, lanes) => {
    Object.values(lanes ?? {}).forEach((s) => { acc += (s?.n ?? 0); });
    return acc;
  }, 0);

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">챔피언 티어표</h1>
          <div className="page-subtitle">
            패치 {data.PATCH} · {bracket} · 표본수 {totalSample.toLocaleString('ko-KR')} 게임
          </div>
        </div>
        <div className="patch-info">
          패치 <span className="patch-num">{data.PATCH}</span>
        </div>
      </header>

      <div className="filters" role="group" aria-label="티어표 필터">
        <div className="filter-row">
          <span className="filter-label">라인</span>
          {LANES.map((l) => {
            const next = new URLSearchParams({ bracket });
            if (l.key !== 'all') next.set('lane', l.key);
            const isActive = lane === l.key;
            return (
              <Link key={l.key} href={`/champions?${next.toString()}`} className={`filter-chip${isActive ? ' active' : ''}`}>
                {l.label}
              </Link>
            );
          })}
        </div>
        <div className="filter-row">
          <span className="filter-label">티어</span>
          {BRACKETS.map((b) => {
            const next = new URLSearchParams({ bracket: b.key });
            if (lane !== 'all') next.set('lane', lane);
            const isActive = bracket === b.key;
            return (
              <Link key={b.key} href={`/champions?${next.toString()}`} className={`filter-chip${isActive ? ' active' : ''}`}>
                {b.label}
              </Link>
            );
          })}
          <span className="filter-meta">픽률 0.5% 이상</span>
        </div>
      </div>

      <div className="data-table">
        <div className="data-table-header tier-table-grid">
          <div>순위</div>
          <div>변동</div>
          <div>챔피언</div>
          <div>라인</div>
          <div className="text-right">PS / 티어</div>
          <div className="text-right honey">꿀챔 점수</div>
          <div className="text-right">승률</div>
          <div className="text-right">픽률</div>
          <div className="text-right ban-col">밴율</div>
          <div className="text-right">표본수</div>
        </div>
        {rows.length === 0 ? (
          <div className="table-footer">표시할 챔프가 없습니다.</div>
        ) : (
          rows.map((r) => {
            const ddChamp = meta.byKey.get(r.champion);
            return (
              <Link
                key={`${r.champion}-${r.lane}`}
                href={`/champions/${encodeURIComponent(r.champion)}?lane=${r.lane}&bracket=${encodeURIComponent(bracket)}`}
                className="data-table-row tier-table-grid"
              >
                <div className="rank-cell">{r.rank}</div>
                <div className={r.trendClass}>
                  {r.trendArrow} {r.trend.wrDelta > 0 ? '+' : ''}{Math.abs(r.trend.wrDelta).toFixed(1)}%
                </div>
                <div className="champ-cell">
                  <ChampionIcon championKey={r.champion} size={32} alt={ddChamp?.name ?? r.champion} />
                  <span className="champ-cell-name">{ddChamp?.name ?? r.champion}</span>
                </div>
                <div className="lane-cell">{laneKr(r.lane)}</div>
                <div className="text-right" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                  <span className={`tier-badge ${r.letterClass}`} style={{ padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{r.letter}</span>
                  <span style={{ fontFeatureSettings: '"tnum" on' }}>{r.psScore.toFixed(2)}</span>
                </div>
                <div className="stat-cell honey">{r.honey.toFixed(2)}</div>
                <div className="stat-cell primary">{r.stats.wr.toFixed(2)}%</div>
                <div className="stat-cell">{r.stats.pickrate.toFixed(2)}%</div>
                <div className="stat-cell ban-col">{r.stats.banrate.toFixed(2)}%</div>
                <div className="stat-cell tertiary">{r.stats.n.toLocaleString('ko-KR')}</div>
              </Link>
            );
          })
        )}
        <div className="table-footer">
          {rows.length}개 챔프 · {lane === 'all' ? '전체 라인' : laneKr(lane)} · {bracket}
        </div>
      </div>

      <p className="text-tertiary" style={{ fontSize: 11, marginTop: 'var(--space-3)', lineHeight: 1.7 }}>
        PS Score = 0.55 × WR(Wilson) + 0.20 × PBI + 0.15 × log(픽률) + 0.10 × 밴 시그널 − 표본 페널티
      </p>
    </main>
  );
}
