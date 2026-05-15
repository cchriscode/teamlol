import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet, ApiError } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { parseRiotIdSlug, formatRiotId } from '@/lib/riot-id';
import { getChampionMeta } from '@/lib/champion-meta';
import type { SummonerSearchResponse } from '@/lib/api-types-summoner';

// Live game state changes every few seconds; don't cache.
export const revalidate = 0;
export const dynamic = 'force-dynamic';

interface LiveParticipant {
  puuid: string;
  teamId: number;        // 100 = blue, 200 = red
  championId: number;
  spell1Id: number;
  spell2Id: number;
  tier: string | null;
  rank: string | null;
  lp: number | null;
  wins: number | null;
  losses: number | null;
}

interface LiveGameResponse {
  inGame: boolean;
  gameId?: number;
  gameStartTime?: number;
  gameLength?: number;
  queueId?: number;
  mapId?: number;
  bans?: Array<{ championId: number; teamId: number; pickTurn: number }>;
  participants?: LiveParticipant[];
}

interface PageProps {
  params: Promise<{ region: string; riotId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  return { title: id ? `${formatRiotId(id)} 라이브 — TeamLOL` : '라이브 — TeamLOL' };
}

function tierShort(tier: string | null) {
  if (!tier) return '—';
  const map: Record<string, string> = {
    IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
    EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'CH',
  };
  return map[tier] ?? tier;
}

export default async function LiveGamePage({ params }: PageProps) {
  const { region, riotId } = await params;
  const id = parseRiotIdSlug(riotId);
  if (!id) notFound();

  const slug = `${encodeURIComponent(id.gameName)}%23${encodeURIComponent(id.tagLine)}`;
  const summoner = await apiGet<SummonerSearchResponse>(`/api/summoner/${region}/${slug}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!summoner) notFound();

  const live = await apiGet<LiveGameResponse>(`/api/live/${region}/${summoner.account.puuid}`).catch(() => null);
  const meta = await getChampionMeta();

  if (!live || !live.inGame || !live.participants) {
    return (
      <main className="page">
        <header className="tier-page-header">
          <div>
            <h1 className="page-title">{id.gameName} <span style={{ color: 'var(--text-tertiary)', fontSize: 16, fontWeight: 400 }}>#{id.tagLine}</span></h1>
            <div className="page-subtitle">현재 게임 중이 아닙니다.</div>
          </div>
        </header>
        <p style={{ marginTop: 24 }}>
          <Link href={`/${region}/${riotId}`} style={{ color: 'var(--text-secondary)' }}>← 프로필로</Link>
        </p>
      </main>
    );
  }

  const minutesIn = Math.floor((live.gameLength ?? 0) / 60);
  const blue = live.participants.filter((p) => p.teamId === 100);
  const red = live.participants.filter((p) => p.teamId === 200);

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">라이브 게임</h1>
          <div className="page-subtitle">
            {minutesIn}분 진행 중 · 큐 {live.queueId} · 게임 ID {live.gameId}
          </div>
        </div>
      </header>

      {(['blue', 'red'] as const).map((side) => {
        const team = side === 'blue' ? blue : red;
        return (
          <div
            key={side}
            className="card"
            style={{ padding: 16, marginBottom: 16, borderLeft: `3px solid ${side === 'blue' ? 'var(--color-win)' : 'var(--color-loss)'}` }}
          >
            <div className="section-title">
              <span>{side === 'blue' ? '블루팀' : '레드팀'}</span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {team.map((p) => {
                const champ = meta.byId.get(p.championId);
                const wr = p.wins != null && p.losses != null && (p.wins + p.losses) > 0
                  ? Math.round((p.wins / (p.wins + p.losses)) * 100)
                  : null;
                return (
                  <div
                    key={p.puuid}
                    style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 12, alignItems: 'center', padding: 8, borderTop: '1px solid var(--border-subtle)' }}
                  >
                    {champ ? <ChampionIcon championKey={champ.id} size={36} /> : <div style={{ width: 36, height: 36 }} />}
                    <div>
                      <div className="fw-medium">{champ?.name ?? `#${p.championId}`}</div>
                      <div className="text-tertiary" style={{ fontSize: 11 }}>
                        {tierShort(p.tier)}{p.rank ? ` ${p.rank}` : ''}{p.lp != null ? ` · ${p.lp} LP` : ''}
                      </div>
                    </div>
                    <div className="text-right text-tertiary" style={{ fontSize: 12 }}>
                      {p.wins != null ? `${p.wins}승 ${p.losses}패` : '—'}
                    </div>
                    <div className="text-right stat-cell">{wr != null ? `${wr}%` : '—'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {live.bans && live.bans.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="section-title"><span>밴</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {live.bans.map((b, i) => {
              const champ = meta.byId.get(b.championId);
              if (!champ) return null;
              return <ChampionIcon key={i} championKey={champ.id} size={32} />;
            })}
          </div>
        </div>
      )}
    </main>
  );
}
