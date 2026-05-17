import { notFound } from 'next/navigation';
import { apiGet, ApiError } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import { getDdragonVersion } from '@/lib/ddragon-version';
import { getChampionMeta } from '@/lib/champion-meta';

export const revalidate = 86400;

interface Participant {
  puuid: string;
  slot: number;
  team: 'blue' | 'red';
  lane: string;
  championId: number;
  championKey: string;
  win: boolean;
  k: number; d: number; a: number; kp: number | null;
  cs: number; csAt14: number | null; csDiffAt14: number | null;
  goldPerMin: number; xpPerMin: number;
  dmgToChampPerMin: number; dmgToObj: number;
  damageTakenPerMin: number;
  visionScore: number; wardsPlaced: number; wardsKilled: number;
  timeDeadPct: number;
  soloKills: number; multiKills: number;
  items: number[]; spells: number[];
  aiScore: number | null;
  aiScoreLetter: string | null;
}

interface MatchDetail {
  matchId: string;
  patch: string;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  gameVersion: string;
  bluewin: number | null;
  participants: Participant[];
}

interface PageProps { params: Promise<{ matchId: string }>; }

export async function generateMetadata({ params }: PageProps) {
  const { matchId } = await params;
  return { title: `매치 ${matchId} — TeamLOL` };
}

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}
function timeAgo(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const m = Math.floor(sec / 60); if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { matchId } = await params;
  const [data, meta, version] = await Promise.all([
    apiGet<MatchDetail>(`/api/match/${matchId}`).catch((e) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
    getChampionMeta(),
    getDdragonVersion(),
  ]);
  if (!data) notFound();

  const minutes = Math.floor(data.gameDuration / 60);
  const seconds = data.gameDuration % 60;
  const totalDuration = data.gameDuration;
  const blue = data.participants.filter((p) => p.team === 'blue').sort((a,b)=>a.slot-b.slot);
  const red  = data.participants.filter((p) => p.team === 'red').sort((a,b)=>a.slot-b.slot);
  const maxDmgPerMin = Math.max(...data.participants.map((p) => p.dmgToChampPerMin));
  const maxTakenPerMin = Math.max(...data.participants.map((p) => p.damageTakenPerMin));
  const blueWon = data.bluewin === 1;

  const teamTotals = (team: Participant[]) => ({
    k: team.reduce((s,p)=>s+p.k,0),
    d: team.reduce((s,p)=>s+p.d,0),
    a: team.reduce((s,p)=>s+p.a,0),
    gold: Math.round(team.reduce((s,p)=>s+p.goldPerMin*(totalDuration/60),0)),
  });

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">매치 상세</h1>
          <div className="page-subtitle">
            패치 {data.patch} · 솔로랭크 · {minutes}분 {seconds}초 · {timeAgo(data.gameCreation)}
          </div>
        </div>
      </header>

      {(['blue', 'red'] as const).map((side) => {
        const team = side === 'blue' ? blue : red;
        const won = side === 'blue' ? blueWon : !blueWon;
        const totals = teamTotals(team);
        const sideColor = side === 'blue' ? 'var(--color-win)' : 'var(--color-loss)';

        return (
          <section
            key={side}
            className="card card-padded"
            style={{ marginBottom: 16, borderLeft: `3px solid ${sideColor}` }}
          >
            <div className="section-title">
              <span>
                <span style={{ color: sideColor }}>{side === 'blue' ? '블루팀' : '레드팀'}</span>
                {' '}<span className={`tier-badge ${won ? 'tier-master' : ''}`} style={{ marginLeft: 6 }}>{won ? '승리' : '패배'}</span>
              </span>
              <span className="meta">
                {totals.k}/{totals.d}/{totals.a} · 골드 {totals.gold.toLocaleString('ko-KR')}
              </span>
            </div>

            <table className="scoreboard" style={{ marginTop: 'var(--space-2)' }}>
              <thead>
                <tr>
                  <th>플레이어</th>
                  <th>KDA</th>
                  <th>딜</th>
                  <th>받은 딜</th>
                  <th>CS</th>
                  <th>시야</th>
                  <th>아이템</th>
                  <th>AI</th>
                </tr>
              </thead>
              <tbody>
                {team.map((p) => {
                  const kda = p.d === 0 ? p.k + p.a : (p.k + p.a) / p.d;
                  const totalDmg = Math.round(p.dmgToChampPerMin * (totalDuration / 60));
                  const totalTaken = Math.round(p.damageTakenPerMin * (totalDuration / 60));
                  const dmgPct = maxDmgPerMin > 0 ? Math.round(p.dmgToChampPerMin / maxDmgPerMin * 100) : 0;
                  const takenPct = maxTakenPerMin > 0 ? Math.round(p.damageTakenPerMin / maxTakenPerMin * 100) : 0;
                  const champName = meta.byId.get(p.championId)?.name ?? p.championKey;
                  return (
                    <tr key={p.puuid} className={`team-${side}`}>
                      <td>
                        <div className="player-cell" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ChampionIcon championKey={p.championKey} size={28} alt={champName} version={version} />
                          <div>
                            <div>{champName}</div>
                            <div className="text-tertiary" style={{ fontSize: 10 }}>{laneKr(p.lane)}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="fw-semibold">{p.k} / {p.d} / {p.a}</div>
                        <div className="text-tertiary" style={{ fontSize: 10 }}>
                          KDA {kda.toFixed(2)}{p.kp != null && ` · KP ${Math.round(p.kp * 100)}%`}
                        </div>
                      </td>
                      <td>
                        <span className="dmg-bar-track"><span className="dmg-bar-fill" style={{ width: `${dmgPct}%` }} /></span>
                        {totalDmg.toLocaleString('ko-KR')}
                      </td>
                      <td>
                        <span className="dmg-bar-track"><span className="dmg-bar-fill taken" style={{ width: `${takenPct}%` }} /></span>
                        {totalTaken.toLocaleString('ko-KR')}
                      </td>
                      <td>
                        {p.cs}
                        <div className="text-tertiary" style={{ fontSize: 10 }}>{(p.cs / (totalDuration / 60)).toFixed(1)}/분</div>
                      </td>
                      <td>{p.visionScore}</td>
                      <td>
                        <div className="items-cell" style={{ display: 'flex', gap: 2 }}>
                          {p.items.filter((id) => id > 0).map((id, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} className="item-icon" src={ddragon.itemIcon(id, version)} width={18} height={18} alt="" />
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="fw-semibold">{p.aiScore?.toFixed(0) ?? '—'}</div>
                        {p.aiScoreLetter && <div className="text-tertiary" style={{ fontSize: 10 }}>{p.aiScoreLetter}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </main>
  );
}
