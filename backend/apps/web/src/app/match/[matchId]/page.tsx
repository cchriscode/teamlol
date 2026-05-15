import { notFound } from 'next/navigation';
import { apiGet, ApiError } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';

export const revalidate = 86400; // matches are immutable; cache aggressively

interface Participant {
  puuid: string;
  slot: number;
  team: 'blue' | 'red';
  lane: string;
  championId: number;
  championKey: string;
  win: boolean;
  k: number; d: number; a: number; kp: number | null;
  cs: number;
  goldPerMin: number;
  visionScore: number;
  items: number[];
  spells: number[];
  aiScore: number | null;
  aiScoreLetter: string | null;
}

interface MatchDetailResponse {
  matchId: string;
  patch: string;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  gameVersion: string;
  bluewin: number | null;
  participants: Participant[];
}

interface PageProps {
  params: Promise<{ matchId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { matchId } = await params;
  return { title: `매치 ${matchId} — TeamLOL` };
}

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { matchId } = await params;
  const data = await apiGet<MatchDetailResponse>(`/api/match/${matchId}`).catch((e) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
  if (!data) notFound();

  const minutes = Math.round(data.gameDuration / 60);
  const blueTeam = data.participants.filter((p) => p.team === 'blue');
  const redTeam = data.participants.filter((p) => p.team === 'red');
  const blueWon = data.bluewin === 1;

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">매치 상세</h1>
          <div className="page-subtitle">
            패치 {data.patch} · {minutes}분 · {new Date(data.gameCreation).toLocaleString('ko-KR')}
          </div>
        </div>
      </header>

      {(['blue', 'red'] as const).map((side) => {
        const team = side === 'blue' ? blueTeam : redTeam;
        const won = side === 'blue' ? blueWon : !blueWon;
        return (
          <div key={side} className="card" style={{ padding: 16, marginBottom: 16, borderLeft: `3px solid ${side === 'blue' ? 'var(--color-win)' : 'var(--color-loss)'}` }}>
            <div className="section-title">
              <span>{side === 'blue' ? '블루팀' : '레드팀'} · {won ? '승' : '패'}</span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {team.map((p) => {
                const kda = p.d === 0 ? p.k + p.a : (p.k + p.a) / p.d;
                return (
                  <div
                    key={p.puuid}
                    style={{ display: 'grid', gridTemplateColumns: 'auto 80px 1fr auto auto', gap: 12, alignItems: 'center', padding: 8, borderTop: '1px solid var(--border-subtle)' }}
                  >
                    <ChampionIcon championKey={p.championKey} size={40} />
                    <div className="fw-medium">{laneKr(p.lane)}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {p.items.filter((id) => id > 0).map((id, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={`https://ddragon.leagueoflegends.com/cdn/16.10.1/img/item/${id}.png`}
                          width={24}
                          height={24}
                          alt=""
                          style={{ borderRadius: 4 }}
                        />
                      ))}
                    </div>
                    <div className="text-right">
                      <div className="fw-medium">{p.k}/{p.d}/{p.a}</div>
                      <div className="text-tertiary" style={{ fontSize: 11 }}>KDA {kda.toFixed(2)}</div>
                    </div>
                    <div className="text-right text-tertiary" style={{ fontSize: 12 }}>
                      CS {p.cs} · 시야 {p.visionScore}
                      {p.aiScoreLetter && <div style={{ fontWeight: 600, marginTop: 2 }}>{p.aiScoreLetter}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </main>
  );
}
