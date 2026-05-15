import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { getChampionMeta } from '@/lib/champion-meta';
import type { ChampionTierResponse, Lane, Bracket } from '@/lib/types';

export const revalidate = 600;          // ISR 10min per (lane, bracket) combo

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

const MIN_PICKRATE = 0.5;

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

interface PageProps {
  searchParams: Promise<{ lane?: string; bracket?: string }>;
}

export default async function ChampionsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const lane = (LANES.find((l) => l.key === sp.lane)?.key ?? 'mid') as Lane | 'all';
  const bracket = (BRACKETS.find((b) => b.key === sp.bracket)?.key ?? 'diamond+');

  const params = new URLSearchParams({ bracket });
  if (lane !== 'all') params.set('lane', lane);

  const [data, meta] = await Promise.all([
    apiGet<ChampionTierResponse>(`/api/champions/tier?${params.toString()}`, { next: { revalidate: 600 } }),
    getChampionMeta(),
  ]);

  // Filter + sort on the server (mirrors prototype tier-engine.tierTable basics).
  const rows = data.rows
    .filter((r) => r.pickrate >= MIN_PICKRATE && r.n >= 30)
    .sort((a, b) => b.wr - a.wr)
    .map((r, i) => {
      const champ = meta.byId.get(r.championId);
      return {
        rank: i + 1,
        championId: r.championId,
        championKey: champ?.id ?? `id-${r.championId}`,
        nameKr: champ?.name ?? `#${r.championId}`,
        lane: r.lane,
        wr: r.wr,
        pickrate: r.pickrate,
        banrate: r.banrate,
        n: r.n,
      };
    });

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">챔피언 티어표</h1>
          <div className="page-subtitle">
            패치 {data.patch} · {data.bracket} · 표본수 {data.totalSample.toLocaleString('ko-KR')} 게임
          </div>
        </div>
        <div className="patch-info">
          패치 <span className="patch-num">{data.patch}</span>
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
              <Link
                key={l.key}
                href={`/champions?${next.toString()}`}
                className={`filter-chip${isActive ? ' active' : ''}`}
              >
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
              <Link
                key={b.key}
                href={`/champions?${next.toString()}`}
                className={`filter-chip${isActive ? ' active' : ''}`}
              >
                {b.label}
              </Link>
            );
          })}
          <span className="filter-meta">픽률 {MIN_PICKRATE}% 이상</span>
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
          rows.map((r) => (
            <Link
              key={`${r.championId}-${r.lane}`}
              href={`/champions/${encodeURIComponent(r.championKey)}?lane=${r.lane}&bracket=${encodeURIComponent(bracket)}`}
              className="data-table-row tier-table-grid"
            >
              <div className="rank-cell">{r.rank}</div>
              <div className="text-tertiary">—</div>
              <div className="champ-cell">
                <ChampionIcon championKey={r.championKey} size={32} alt={r.nameKr} />
                <span className="champ-cell-name">{r.nameKr}</span>
              </div>
              <div className="lane-cell">{laneKr(r.lane)}</div>
              <div className="text-right">—</div>
              <div className="stat-cell honey">—</div>
              <div className="stat-cell primary">{r.wr.toFixed(2)}%</div>
              <div className="stat-cell">{r.pickrate.toFixed(2)}%</div>
              <div className="stat-cell ban-col">{r.banrate.toFixed(2)}%</div>
              <div className="stat-cell tertiary">{r.n.toLocaleString('ko-KR')}</div>
            </Link>
          ))
        )}
        <div className="table-footer">
          {rows.length}개 챔프 · {lane === 'all' ? '전체 라인' : laneKr(lane)} · {bracket}
        </div>
      </div>
    </main>
  );
}
