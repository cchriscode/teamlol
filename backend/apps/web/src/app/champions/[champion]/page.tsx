import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { getChampionMeta } from '@/lib/champion-meta';
import type { Lane, Bracket } from '@/lib/types';

export const revalidate = 600;

interface DetailResponse {
  patch: string;
  bracket: string;
  lane: string | null;
  champion: { id: number; key: string; nameKr: string; tags: string[] };
  tier: Array<{ lane: string; wr: number; pickrate: number; banrate: number; n: number; psScore: number | null; avgKda: number | null }>;
  message?: string;
}

interface PageProps {
  params: Promise<{ champion: string }>;
  searchParams: Promise<{ lane?: string; bracket?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { champion } = await params;
  const meta = await getChampionMeta();
  const c = meta.byKey.get(champion);
  return {
    title: c ? `${c.name} 통계 — TeamLOL` : `${champion} — TeamLOL`,
  };
}

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

export default async function ChampionDetailPage({ params, searchParams }: PageProps) {
  const { champion } = await params;
  const sp = await searchParams;
  const lane = (sp.lane ?? 'mid') as Lane;
  const bracket = (sp.bracket ?? 'diamond+') as Bracket;

  const meta = await getChampionMeta();
  const ddChamp = meta.byKey.get(champion);
  if (!ddChamp) notFound();

  const data = await apiGet<DetailResponse>(
    `/api/champions/${ddChamp.key}/detail?lane=${lane}&bracket=${encodeURIComponent(bracket)}`,
    { next: { revalidate: 600 } },
  ).catch(() => null);

  return (
    <main className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <ChampionIcon championKey={champion} size={80} alt={ddChamp.name} />
        <div>
          <h1 className="page-title">{ddChamp.name}</h1>
          <div className="page-subtitle">{ddChamp.title}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            {ddChamp.tags.map((t) => (
              <span key={t} className="tier-badge">{t}</span>
            ))}
          </div>
        </div>
      </div>

      <p style={{ marginBottom: 16 }}>
        <Link href={`/champions?lane=${lane}&bracket=${encodeURIComponent(bracket)}`} style={{ color: 'var(--text-secondary)' }}>
          ← 티어표로
        </Link>
      </p>

      {data && data.tier && data.tier.length > 0 ? (
        <div className="data-table">
          <div className="data-table-header" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', padding: 12, gap: 12 }}>
            <div>라인</div>
            <div className="text-right">승률</div>
            <div className="text-right">픽률</div>
            <div className="text-right ban-col">밴율</div>
            <div className="text-right">평균 KDA</div>
            <div className="text-right">표본수</div>
          </div>
          {data.tier.map((t) => (
            <div key={t.lane} className="data-table-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr 1fr', padding: 12, gap: 12 }}>
              <div>{laneKr(t.lane)}</div>
              <div className="stat-cell primary">{t.wr.toFixed(2)}%</div>
              <div className="stat-cell">{t.pickrate.toFixed(2)}%</div>
              <div className="stat-cell ban-col">{t.banrate.toFixed(2)}%</div>
              <div className="stat-cell">{t.avgKda?.toFixed(2) ?? '—'}</div>
              <div className="stat-cell tertiary">{t.n.toLocaleString('ko-KR')}</div>
            </div>
          ))}
          <div className="table-footer">
            패치 {data.patch} · {data.bracket}
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          이 브래킷·라인에서 데이터가 부족합니다.
        </div>
      )}
    </main>
  );
}
