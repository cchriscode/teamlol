import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { getChampionMeta } from '@/lib/champion-meta';
import { buildPickData } from '@/app/pick/build-pick-data';
import { createTierEngine } from '@/lib/tier-engine';
import { laneKr } from '@/lib/display';
import type { Lane, Bracket } from '@/lib/types';

export const revalidate = 600;
// Paths render on-demand (first request prerenders + caches for 600s).
// We previously pre-rendered all 30 combinations at build, but that
// required the Cloudflare tunnel to the user's local API to be alive
// AND respond within 60s for every path — neither was reliable, so
// Vercel builds kept timing out. Empty generateStaticParams keeps
// build-time API calls out of the critical path.
export const dynamicParams = true;

const LANES: Array<{ key: Lane | 'all'; label: string }> = [
  { key: 'all',     label: '전체'  },
  { key: 'top',     label: '탑'    },
  { key: 'jungle',  label: '정글'  },
  { key: 'mid',     label: '미드'  },
  { key: 'adc',     label: '원딜'  },
  { key: 'support', label: '서폿'  },
];

// URL slug ↔ bracket key. The `+` in the canonical bracket keys
// (`diamond+`, `master+`...) breaks Next.js path matching when the
// browser/CDN encodes it as `%2B`, so the URL form uses `-plus` suffixes
// and we map back to the canonical key for API calls + display lookup.
const BRACKETS: Array<{ slug: string; key: Bracket; label: string }> = [
  { slug: 'emerald-plus',  key: 'emerald+',   label: '에메랄드+'    },
  { slug: 'diamond-plus',  key: 'diamond+',   label: '다이아몬드+'  },
  { slug: 'master-plus',   key: 'master+',    label: '마스터+'      },
  { slug: 'gm-plus',       key: 'gm+',        label: '그랜드마스터+' },
  { slug: 'challenger',    key: 'challenger', label: '챌린저'       },
];

// Empty list = no build-time prerender. Combined with dynamicParams=true,
// each (bracket, lane) renders on first request and caches via the
// `revalidate` setting above. Avoids depending on the tunnel during
// `next build`.
export function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ bracket: string; lane: string }>;
}

export default async function ChampionsListPage({ params }: PageProps) {
  const { bracket: bracketParam, lane: laneParam } = await params;
  const bracketEntry = BRACKETS.find((b) => b.slug === bracketParam);
  const lane = LANES.find((l) => l.key === laneParam)?.key;
  if (!bracketEntry || !lane) notFound();
  const bracket = bracketEntry.key;

  const [api, meta] = await Promise.all([
    apiGet<Parameters<typeof buildPickData>[0]>(
      `/api/pick-recommend/data?bracket=${encodeURIComponent(bracket)}`,
      { next: { revalidate: 600 } },
    ),
    getChampionMeta(),
  ]);

  const data = buildPickData(api, { byId: meta.byId, byKey: meta.byKey });
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
          {LANES.map((l) => (
            <Link key={l.key} href={`/champions/${bracketEntry.slug}/${l.key}`} className={`filter-chip${lane === l.key ? ' active' : ''}`}>
              {l.label}
            </Link>
          ))}
        </div>
        <div className="filter-row">
          <span className="filter-label">티어</span>
          {BRACKETS.map((b) => (
            <Link key={b.slug} href={`/champions/${b.slug}/${lane}`} className={`filter-chip${bracket === b.key ? ' active' : ''}`}>
              {b.label}
            </Link>
          ))}
          <span className="filter-meta">픽률 0.5% 이상</span>
        </div>
      </div>

      <div className="data-table">
        <div className="data-table-header tier-table-grid">
          <div>순위</div>
          <div>변동</div>
          <div>챔피언</div>
          <div>라인</div>
          <div className="text-right">점수 / 등급</div>
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
                href={`/champion/${encodeURIComponent(r.champion)}?lane=${r.lane}&bracket=${encodeURIComponent(bracket)}`}
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
                  <span style={{ fontFeatureSettings: '"tnum" on' }}>{r.tierScore.toFixed(2)}</span>
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
        점수 = 0.55 × WR(Wilson 신뢰하한) + 0.20 × 라인 대비 우위 + 0.15 × log(픽률) + 0.10 × 밴 시그널 − 표본 페널티
      </p>
    </main>
  );
}
