import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet, ApiError } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { parseRiotIdSlug, formatRiotId } from '@/lib/riot-id';
import type { SummonerSearchResponse } from '@/lib/api-types-summoner';

export const revalidate = 600;

interface PatchStat {
  patch: string;
  games: number;
  wins: number;
  winrate: number;
  avgAiScore: number;
  firstAt: number;
  lastAt: number;
  topChampions: Array<{ championKey: string; championId: number; games: number; wins: number }>;
}

interface SeasonsResponse {
  puuid: string;
  patches: PatchStat[];
}

interface PageProps {
  params: Promise<{ region: string; riotId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  return { title: id ? `${formatRiotId(id)} 시즌 — TeamLOL` : '시즌 — TeamLOL' };
}

export default async function SummonerSeasonsPage({ params }: PageProps) {
  const { region, riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  if (!id) notFound();

  const slug = `${encodeURIComponent(id.gameName)}%23${encodeURIComponent(id.tagLine)}`;
  const summoner = await apiGet<SummonerSearchResponse>(`/api/summoner/${region}/${slug}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!summoner) notFound();

  const data = await apiGet<SeasonsResponse>(`/api/summoner/${summoner.account.puuid}/seasons`).catch(() => ({ puuid: '', patches: [] as PatchStat[] }));

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">
            {id.gameName}
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, marginLeft: 8, fontSize: 18 }}>#{id.tagLine}</span>
          </h1>
          <div className="page-subtitle">패치별 통계 · {data.patches.length}개 패치</div>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Link href={`/${region}/${riotId}`} className="filter-chip">개요</Link>
        <Link href={`/${region}/${riotId}/champions`} className="filter-chip">챔피언</Link>
        <Link href={`/${region}/${riotId}/seasons`} className="filter-chip active">시즌</Link>
        <Link href={`/${region}/${riotId}/live`} className="filter-chip">라이브</Link>
      </div>

      {data.patches.length === 0 ? (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          데이터가 없습니다.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {data.patches.map((p) => (
            <div key={p.patch} className="card" style={{ padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <div className="fw-medium" style={{ fontSize: 18 }}>패치 {p.patch}</div>
                <div className="text-tertiary" style={{ fontSize: 12 }}>
                  {new Date(p.firstAt).toLocaleDateString('ko-KR')} ~ {new Date(p.lastAt).toLocaleDateString('ko-KR')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                <div>
                  <div className="text-tertiary" style={{ fontSize: 11 }}>판수</div>
                  <div className="stat-cell primary" style={{ fontSize: 18 }}>{p.games}</div>
                </div>
                <div>
                  <div className="text-tertiary" style={{ fontSize: 11 }}>승률</div>
                  <div className="stat-cell primary" style={{ fontSize: 18 }}>{p.winrate}%</div>
                </div>
                <div>
                  <div className="text-tertiary" style={{ fontSize: 11 }}>AI 점수</div>
                  <div className="stat-cell" style={{ fontSize: 18 }}>{p.avgAiScore}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="text-tertiary" style={{ fontSize: 11 }}>주력 챔프</span>
                  {p.topChampions.map((c) => (
                    <ChampionIcon key={c.championId} championKey={c.championKey} size={32} />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
