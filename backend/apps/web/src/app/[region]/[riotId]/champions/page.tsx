import { notFound } from 'next/navigation';
import { apiGet, ApiError } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { parseRiotIdSlug, formatRiotId } from '@/lib/riot-id';
import type { SummonerSearchResponse } from '@/lib/api-types-summoner';
import { getChampionMeta } from '@/lib/champion-meta';
import { SummonerHeader } from '../summoner-header';

export const revalidate = 300;

interface ChampionStat {
  championId: number;
  championKey: string;
  lane: string;
  games: number;
  wins: number;
  avgKda: number;
  cspm: number;
  goldPerMin: number;
  dmgPerMin: number;
  csDiffAt14: number;
  avgAiScore: number;
  lastPlayedAt: number;
}

interface PageProps {
  params: Promise<{ region: string; riotId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  return { title: id ? `${formatRiotId(id)} 챔피언 — TeamLOL` : '챔피언 — TeamLOL' };
}

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

export default async function SummonerChampionsPage({ params }: PageProps) {
  const { region, riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  if (!id) notFound();

  const slug = `${encodeURIComponent(id.gameName)}%23${encodeURIComponent(id.tagLine)}`;
  const summoner = await apiGet<SummonerSearchResponse>(`/api/summoner/${region}/${slug}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!summoner) notFound();

  const statsResp = await apiGet<{ rows: ChampionStat[] }>(`/api/summoner/${summoner.account.puuid}/champion-stats?minGames=1`).catch(() => ({ rows: [] as ChampionStat[] }));
  const stats = statsResp.rows ?? [];
  const meta = await getChampionMeta();

  return (
    <main className="page">
      <SummonerHeader summoner={summoner} region={region} riotId={riotId} tab="champions" />

      <div className="data-table">
        <div
          className="data-table-header"
          style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 80px 80px 80px 80px 80px', padding: 12, gap: 12 }}
        >
          <div>챔피언</div>
          <div className="text-right">라인</div>
          <div className="text-right">판수</div>
          <div className="text-right">승률</div>
          <div className="text-right">KDA</div>
          <div className="text-right">CS/분</div>
          <div className="text-right">골드/분</div>
          <div className="text-right">AI 점수</div>
        </div>
        {stats.length === 0 ? (
          <div className="table-footer">데이터가 없습니다.</div>
        ) : (
          stats.map((s) => {
            const wr = s.games > 0 ? (s.wins / s.games) * 100 : 0;
            const champ = meta.byId.get(s.championId);
            return (
              <div
                key={`${s.championId}-${s.lane}`}
                className="data-table-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 80px 60px 80px 80px 80px 80px 80px', padding: 12, gap: 12, alignItems: 'center' }}
              >
                <div className="champ-cell">
                  <ChampionIcon championKey={s.championKey} size={32} alt={champ?.name ?? s.championKey} />
                  <span className="champ-cell-name">{champ?.name ?? s.championKey}</span>
                </div>
                <div className="text-right">{laneKr(s.lane)}</div>
                <div className="text-right stat-cell">{s.games}</div>
                <div className={`text-right stat-cell ${wr >= 55 ? 'primary' : ''}`}>{wr.toFixed(1)}%</div>
                <div className="text-right stat-cell">{s.avgKda?.toFixed(2) ?? '—'}</div>
                <div className="text-right stat-cell tertiary">{s.cspm?.toFixed(1) ?? '—'}</div>
                <div className="text-right stat-cell tertiary">{s.goldPerMin?.toFixed(0) ?? '—'}</div>
                <div className="text-right stat-cell">{s.avgAiScore?.toFixed(1) ?? '—'}</div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}
