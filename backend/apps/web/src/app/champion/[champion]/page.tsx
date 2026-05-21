import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import { getChampionMeta } from '@/lib/champion-meta';
import { getDdragonVersion } from '@/lib/ddragon-version';
import { spellKey } from '@/lib/summoner-spells';
import { tierKr, tierClass } from '@/lib/display';
import { slugFromRiotId } from '@/lib/riot-id';
import type { Lane, Bracket } from '@/lib/types';

export const revalidate = 600;

interface TierStat { lane: string; wr: number; pickrate: number; banrate: number; n: number; tierScore: number | null; avgKda: number | null; }
interface Matchup  { lane: string; opponentId: number; opponentKey: string; opponentNameKr: string; wr: number; games: number; csDiffAt14: number | null; }
interface Synergy  { partnerId: number; partnerKey: string; partnerNameKr: string; pairWr: number; synergyDelta: number; games: number; }
interface BotDuo   { adcId: number; adcKey: string; supId: number; supKey: string; pairWr: number; games: number; }
interface PowerRow { lane: string; bucket: string; minMinute: number; maxMinute: number; games: number; wins: number; wr: number; }

interface DetailResponse {
  patch: string;
  bracket: string;
  lane: string | null;
  champion: { id: number; key: string; nameKr: string; tags: string[] };
  tier: TierStat[];
  power: PowerRow[];
  bestMatchups: Matchup[];
  worstMatchups: Matchup[];
  synergies: Synergy[];
  botDuos: BotDuo[];
}

interface Specialist {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  profileIconId: number | null;
  tier: string; rank: string; lp: number;
  games: number; wins: number; winrate: number;
  avgKda: number; avgAi: number;
  firstItems: number[];
  spells: number[];
  keystoneIcon: string | null;
  subStyleId: number | null;
}
interface SpecialistsResponse {
  specialists: Specialist[];
}

const LANES: Array<{ key: Lane; label: string }> = [
  { key: 'top', label: '탑' }, { key: 'jungle', label: '정글' },
  { key: 'mid', label: '미드' }, { key: 'adc', label: '원딜' },
  { key: 'support', label: '서폿' },
];

const BRACKETS: Array<{ key: Bracket; label: string }> = [
  { key: 'emerald+',   label: '에메랄드+' },
  { key: 'diamond+',   label: '다이아몬드+' },
  { key: 'master+',    label: '마스터+' },
  { key: 'gm+',        label: '그랜드마스터+' },
  { key: 'challenger', label: '챌린저' },
];

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

function tagKr(tag: string): string {
  return ({
    Fighter: '전사', Tank: '탱커', Mage: '마법사', Assassin: '암살자',
    Marksman: '원거리', Support: '서포터',
  } as Record<string, string>)[tag] ?? tag;
}

interface PageProps {
  params: Promise<{ champion: string }>;
  searchParams: Promise<{ lane?: string; bracket?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { champion } = await params;
  const meta = await getChampionMeta();
  const c = meta.byKey.get(champion);
  return { title: c ? `${c.name} 통계 — TeamLOL` : `${champion} — TeamLOL` };
}

export default async function ChampionDetailPage({ params, searchParams }: PageProps) {
  const { champion } = await params;
  const sp = await searchParams;
  const meta = await getChampionMeta();
  const ddChamp = meta.byKey.get(champion);
  if (!ddChamp) notFound();

  const lane: Lane = (LANES.find((l) => l.key === sp.lane)?.key ?? 'mid');
  const bracket: Bracket = (BRACKETS.find((b) => b.key === sp.bracket)?.key ?? 'emerald+');

  const [data, specialists, version] = await Promise.all([
    apiGet<DetailResponse>(
      `/api/champions/${ddChamp.key}/detail?lane=${lane}&bracket=${encodeURIComponent(bracket)}`,
      { next: { revalidate: 600 } },
    ),
    apiGet<SpecialistsResponse>(
      `/api/champions/${ddChamp.key}/specialists?bracket=${encodeURIComponent(bracket)}&lane=${lane}&limit=20`,
      { next: { revalidate: 600 } },
    ).catch(() => ({ specialists: [] }) as SpecialistsResponse),
    getDdragonVersion(),
  ]);

  const myStat = data.tier.find((t) => t.lane === lane) ?? data.tier[0] ?? null;
  const splashUrl = ddragon.championSplash(ddChamp.id);

  return (
    <main className="page">
      <header className="champ-splash-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="champ-splash-img" src={splashUrl} alt="" aria-hidden="true" />
        <div className="champ-splash-overlay" />
        <div className="champ-splash-content">
          <ChampionIcon championKey={ddChamp.id} size={80} alt={ddChamp.name} />
          <div className="champ-splash-text">
            <h1 className="champ-splash-title">
              {ddChamp.name}
              {' '}<span className="text-tertiary fw-medium" style={{ fontSize: 14 }}>{ddChamp.tags?.map(tagKr).join(' · ')}</span>
            </h1>
            <div className="champ-splash-subtitle">{laneKr(lane)} · 패치 {data.patch}</div>
            {myStat && (
              <div className="champ-splash-stats">
                <div><div className="champ-splash-stat-label">승률</div><div className="champ-splash-stat-value">{myStat.wr.toFixed(2)}%</div></div>
                <div><div className="champ-splash-stat-label">픽률</div><div className="champ-splash-stat-value">{myStat.pickrate.toFixed(2)}%</div></div>
                <div><div className="champ-splash-stat-label">밴율</div><div className="champ-splash-stat-value">{myStat.banrate.toFixed(2)}%</div></div>
                <div><div className="champ-splash-stat-label">평균 KDA</div><div className="champ-splash-stat-value">{myStat.avgKda?.toFixed(2) ?? '—'}</div></div>
                <div><div className="champ-splash-stat-label">표본수</div><div className="champ-splash-stat-value">{myStat.n.toLocaleString('ko-KR')}</div></div>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="filters" role="group" aria-label="챔피언 상세 필터">
        <div className="filter-row">
          <span className="filter-label">라인</span>
          {LANES.map((l) => (
            <Link
              key={l.key}
              href={`/champion/${encodeURIComponent(champion)}?lane=${l.key}&bracket=${encodeURIComponent(bracket)}`}
              className={`filter-chip${lane === l.key ? ' active' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="filter-row">
          <span className="filter-label">티어</span>
          {BRACKETS.map((b) => (
            <Link
              key={b.key}
              href={`/champion/${encodeURIComponent(champion)}?lane=${lane}&bracket=${encodeURIComponent(b.key)}`}
              className={`filter-chip${bracket === b.key ? ' active' : ''}`}
            >
              {b.label}
            </Link>
          ))}
          <span className="filter-meta">패치 {data.patch} 기준</span>
        </div>
      </div>

      <div className="champ-detail-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Per-lane breakdown */}
          <section className="card card-padded">
            <div className="section-title">
              <span>라인별 통계</span>
              <span className="meta">{data.tier.length}개 라인</span>
            </div>
            <table className="scoreboard" style={{ marginTop: 'var(--space-2)' }}>
              <thead>
                <tr>
                  <th>라인</th>
                  <th>승률</th>
                  <th>픽률</th>
                  <th>밴율</th>
                  <th>평균 KDA</th>
                  <th>표본</th>
                </tr>
              </thead>
              <tbody>
                {data.tier.map((t) => (
                  <tr key={t.lane}>
                    <td>{laneKr(t.lane)}</td>
                    <td className={t.wr >= 52 ? 'text-positive fw-semibold' : t.wr <= 48 ? 'text-loss fw-semibold' : ''}>{t.wr.toFixed(2)}%</td>
                    <td>{t.pickrate.toFixed(2)}%</td>
                    <td>{t.banrate.toFixed(2)}%</td>
                    <td>{t.avgKda?.toFixed(2) ?? '—'}</td>
                    <td>{t.n.toLocaleString('ko-KR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Power curve — wr by game-length bucket */}
          <PowerCurve power={data.power} lane={lane} />

          {/* Best matchups */}
          {data.bestMatchups.length > 0 && (
            <section className="card card-padded">
              <div className="section-title">
                <span>유리한 매치업</span>
                <span className="meta">{laneKr(lane)} · 승률 높은 순</span>
              </div>
              <table className="scoreboard" style={{ marginTop: 'var(--space-2)' }}>
                <thead><tr><th>상대</th><th>승률</th><th>표본</th><th>CS차이@14</th></tr></thead>
                <tbody>
                  {data.bestMatchups.map((m) => {
                    const opChamp = meta.byId.get(m.opponentId);
                    return (
                      <tr key={m.opponentId}>
                        <td>
                          <div className="player-cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChampionIcon championKey={opChamp?.id ?? m.opponentKey} size={20} alt="" />
                            <span>{opChamp?.name ?? m.opponentKey}</span>
                          </div>
                        </td>
                        <td className="text-positive fw-semibold">{m.wr.toFixed(2)}%</td>
                        <td>{m.games}</td>
                        <td className={m.csDiffAt14 != null && m.csDiffAt14 > 0 ? 'text-positive' : 'text-loss'}>
                          {m.csDiffAt14 != null ? (m.csDiffAt14 > 0 ? '+' : '') + m.csDiffAt14.toFixed(1) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Worst matchups */}
          {data.worstMatchups.length > 0 && (
            <section className="card card-padded">
              <div className="section-title">
                <span>불리한 매치업</span>
                <span className="meta">{laneKr(lane)} · 승률 낮은 순</span>
              </div>
              <table className="scoreboard" style={{ marginTop: 'var(--space-2)' }}>
                <thead><tr><th>상대</th><th>승률</th><th>표본</th><th>CS차이@14</th></tr></thead>
                <tbody>
                  {data.worstMatchups.map((m) => {
                    const opChamp = meta.byId.get(m.opponentId);
                    return (
                      <tr key={m.opponentId}>
                        <td>
                          <div className="player-cell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChampionIcon championKey={opChamp?.id ?? m.opponentKey} size={20} alt="" />
                            <span>{opChamp?.name ?? m.opponentKey}</span>
                          </div>
                        </td>
                        <td className="text-loss fw-semibold">{m.wr.toFixed(2)}%</td>
                        <td>{m.games}</td>
                        <td className={m.csDiffAt14 != null && m.csDiffAt14 > 0 ? 'text-positive' : 'text-loss'}>
                          {m.csDiffAt14 != null ? (m.csDiffAt14 > 0 ? '+' : '') + m.csDiffAt14.toFixed(1) : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Synergies */}
          {data.synergies.length > 0 && (
            <section className="card card-padded">
              <div className="section-title">
                <span>시너지 좋은 챔프</span>
                <span className="meta">팀 동승률</span>
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {data.synergies.slice(0, 10).map((s) => {
                  const partner = meta.byId.get(s.partnerId);
                  return (
                    <div key={s.partnerId} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center', padding: 6 }}>
                      <ChampionIcon championKey={partner?.id ?? s.partnerKey} size={28} alt="" />
                      <span>{partner?.name ?? s.partnerKey}</span>
                      <span className={`${s.synergyDelta >= 0 ? 'text-positive' : 'text-loss'} fw-semibold`} style={{ fontSize: 13 }}>
                        {s.synergyDelta >= 0 ? '+' : ''}{s.synergyDelta.toFixed(2)}%
                      </span>
                      <span className="text-tertiary" style={{ fontSize: 11 }}>{s.games}판</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Bot duos (if support/adc) */}
          {data.botDuos.length > 0 && (
            <section className="card card-padded">
              <div className="section-title">
                <span>봇 듀오 시너지</span>
              </div>
              <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                {data.botDuos.slice(0, 10).map((d, i) => {
                  const partnerId = d.adcKey === ddChamp.id ? d.supId : d.adcId;
                  const partnerKey = d.adcKey === ddChamp.id ? d.supKey : d.adcKey;
                  const partner = meta.byId.get(partnerId);
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 8, alignItems: 'center', padding: 6 }}>
                      <ChampionIcon championKey={partner?.id ?? partnerKey} size={28} alt="" />
                      <span>{partner?.name ?? partnerKey}</span>
                      <span className="text-positive fw-semibold" style={{ fontSize: 13 }}>{d.pairWr.toFixed(2)}%</span>
                      <span className="text-tertiary" style={{ fontSize: 11 }}>{d.games}판</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </aside>
      </div>

      {specialists.specialists.length > 0 && (
        <section className="card card-padded" style={{ marginTop: 'var(--space-4)' }}>
          <div className="section-title">
            <span>{ddChamp.name} 장인 랭킹</span>
            <span className="meta">{laneKr(lane)} · {bracket} · 게임수 기준 상위 {specialists.specialists.length}명</span>
          </div>
          <div className="specialists-table">
            <div className="specialists-row specialists-header">
              <span className="specialists-col-rank">#</span>
              <span className="specialists-col-name">소환사</span>
              <span className="specialists-col-tier">티어</span>
              <span className="specialists-col-stats">게임 / 승률 / KDA</span>
              <span className="specialists-col-runes">룬 · 스펠</span>
              <span className="specialists-col-items">최근 빌드 (3템)</span>
            </div>
            {specialists.specialists.map((s, i) => {
              const linkable = s.gameName && s.tagLine;
              const nameHref = linkable ? `/kr/${slugFromRiotId({ gameName: s.gameName!, tagLine: s.tagLine! })}` : null;
              return (
                <div key={s.puuid} className="specialists-row">
                  <span className="specialists-col-rank">{i + 1}</span>
                  <span className="specialists-col-name">
                    {s.profileIconId != null && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="profile-icon-img" src={ddragon.profileIcon(s.profileIconId, version)} width={24} height={24} alt="" />
                    )}
                    {nameHref ? (
                      <Link href={nameHref} className="specialists-name-link">{s.gameName}<span className="text-tertiary"> #{s.tagLine}</span></Link>
                    ) : (
                      <span>{s.gameName ?? s.puuid.slice(0, 6)}</span>
                    )}
                  </span>
                  <span className="specialists-col-tier">
                    <span className={`tier-badge ${tierClass(s.tier)}`}>{tierKr(s.tier)} {s.rank}</span>
                    <span className="text-tertiary" style={{ marginLeft: 4, fontSize: 11 }}>{s.lp} LP</span>
                  </span>
                  <span className="specialists-col-stats">
                    <span>{s.games}게임</span>
                    <span className={s.winrate >= 55 ? 'text-positive fw-semibold' : s.winrate < 50 ? 'text-loss' : 'fw-semibold'}>
                      {s.winrate.toFixed(1)}%
                    </span>
                    <span className="text-tertiary">{s.avgKda.toFixed(2)} KDA</span>
                  </span>
                  <span className="specialists-col-runes">
                    {s.keystoneIcon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ddragon.runeIcon(s.keystoneIcon)} width={22} height={22} alt="" className="rune-icon" />
                    )}
                    {s.subStyleId != null && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ddragon.runeStyleIcon(s.subStyleId)} width={16} height={16} alt="" className="rune-style-icon" />
                    )}
                    {s.spells.slice(0, 2).map((id, k) => {
                      const sk = spellKey(id);
                      return sk ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={k} src={ddragon.spellIcon(sk, version)} width={18} height={18} alt="" className="spell-icon" />
                      ) : null;
                    })}
                  </span>
                  <span className="specialists-col-items">
                    {s.firstItems.map((id, k) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={k} src={ddragon.itemIcon(id, version)} width={24} height={24} alt="" className="item-icon" />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}

// ---- Power curve chart ------------------------------------------------
// Inline SVG so we don't pull in recharts/visx for a single 5-point line.
const BUCKET_ORDER = ['short', 'mid_short', 'mid', 'mid_long', 'long'] as const;
const BUCKET_LABEL: Record<string, string> = {
  short: '~20분', mid_short: '20-25분', mid: '25-30분', mid_long: '30-35분', long: '35분+',
};

function PowerCurve({ power, lane }: { power: PowerRow[]; lane: Lane }) {
  // Aggregate across lanes when current view is 'all', otherwise filter to lane.
  // (PageProps already constrains lane to one of the 5; this is defensive.)
  const filtered = power.filter((p) => p.lane === lane);
  if (filtered.length === 0) {
    return null;
  }
  // Re-bucket and aggregate by bucket key.
  const byBucket = new Map<string, { games: number; wins: number }>();
  for (const r of filtered) {
    const cur = byBucket.get(r.bucket) ?? { games: 0, wins: 0 };
    cur.games += r.games; cur.wins += r.wins;
    byBucket.set(r.bucket, cur);
  }
  const points = BUCKET_ORDER.map((k) => {
    const v = byBucket.get(k);
    if (!v || v.games < 20) return { k, wr: null as number | null, games: v?.games ?? 0 };
    return { k, wr: (v.wins / v.games) * 100, games: v.games };
  });
  const valid = points.filter((p) => p.wr != null) as Array<{ k: string; wr: number; games: number }>;
  if (valid.length < 2) return null;

  const W = 560, H = 180, PAD = { l: 36, r: 16, t: 16, b: 32 };
  const xs = points.map((_, i) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const yScale = (wr: number) => {
    // Center on 50; 40-60 visible range with clamp.
    const clamped = Math.max(40, Math.min(60, wr));
    const t = (clamped - 40) / 20;
    return H - PAD.b - t * (H - PAD.t - PAD.b);
  };
  const segments: string[] = [];
  let pen = '';
  points.forEach((p, i) => {
    if (p.wr == null) { pen = ''; return; }
    const x = xs[i].toFixed(1), y = yScale(p.wr).toFixed(1);
    if (!pen) { segments.push(`M ${x} ${y}`); pen = 'L'; }
    else segments.push(`${pen} ${x} ${y}`);
  });

  // Find peak bucket for the headline summary.
  const peak = valid.reduce((a, b) => (b.wr > a.wr ? b : a));
  const trough = valid.reduce((a, b) => (b.wr < a.wr ? b : a));
  const swing = peak.wr - trough.wr;

  return (
    <section className="card card-padded">
      <div className="section-title">
        <span>파워 그래프 ({laneKr(lane)})</span>
        <span className="meta">게임 길이별 승률</span>
      </div>
      <div className="text-tertiary" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
        {swing >= 3
          ? <>강한 시점: <strong>{BUCKET_LABEL[peak.k]}</strong> ({peak.wr.toFixed(1)}%) · 약한 시점: <strong>{BUCKET_LABEL[trough.k]}</strong> ({trough.wr.toFixed(1)}%)</>
          : '전 구간 비슷 — 파워 스파이크가 약한 챔프'}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 8 }}>
        {/* 50% baseline */}
        <line
          x1={PAD.l} x2={W - PAD.r} y1={yScale(50)} y2={yScale(50)}
          stroke="var(--border-strong)" strokeDasharray="3 3" strokeWidth="1"
        />
        {/* y-axis ticks at 45/50/55 */}
        {[45, 50, 55].map((wr) => (
          <text key={wr} x={PAD.l - 6} y={yScale(wr) + 3} fontSize="10"
                fill="var(--text-tertiary)" textAnchor="end">
            {wr}%
          </text>
        ))}
        {/* x-axis labels */}
        {points.map((p, i) => (
          <text key={p.k} x={xs[i]} y={H - 10} fontSize="10"
                fill="var(--text-tertiary)" textAnchor="middle">
            {BUCKET_LABEL[p.k]}
          </text>
        ))}
        {/* main line */}
        <path d={segments.join(' ')} fill="none" stroke="var(--color-win)" strokeWidth="2" />
        {/* dots */}
        {points.map((p, i) => p.wr != null ? (
          <g key={p.k}>
            <circle cx={xs[i]} cy={yScale(p.wr)} r="3.5" fill="var(--color-win)" />
            <text x={xs[i]} y={yScale(p.wr) - 8} fontSize="10"
                  fill={p.wr >= 51 ? 'var(--color-positive)' : p.wr <= 49 ? 'var(--color-loss)' : 'var(--text-secondary)'}
                  textAnchor="middle" fontWeight="600">
              {p.wr.toFixed(1)}%
            </text>
          </g>
        ) : null)}
      </svg>
      <div className="text-tertiary" style={{ fontSize: 10, marginTop: 4 }}>
        표본 적은 구간(&lt;20 게임)은 표시하지 않음 · 전체 {valid.reduce((a, b) => a + b.games, 0).toLocaleString('ko-KR')} 게임 기준
      </div>
    </section>
  );
}
