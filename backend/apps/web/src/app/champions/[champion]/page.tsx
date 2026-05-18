import { notFound } from 'next/navigation';
import Link from 'next/link';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import { getChampionMeta } from '@/lib/champion-meta';
import type { Lane, Bracket } from '@/lib/types';

export const revalidate = 600;

interface TierStat { lane: string; wr: number; pickrate: number; banrate: number; n: number; tierScore: number | null; avgKda: number | null; }
interface Matchup  { lane: string; opponentId: number; opponentKey: string; opponentNameKr: string; wr: number; games: number; csDiffAt14: number | null; }
interface Synergy  { partnerId: number; partnerKey: string; partnerNameKr: string; pairWr: number; synergyDelta: number; games: number; }
interface BotDuo   { adcId: number; adcKey: string; supId: number; supKey: string; pairWr: number; games: number; }

interface DetailResponse {
  patch: string;
  bracket: string;
  lane: string | null;
  champion: { id: number; key: string; nameKr: string; tags: string[] };
  tier: TierStat[];
  bestMatchups: Matchup[];
  worstMatchups: Matchup[];
  synergies: Synergy[];
  botDuos: BotDuo[];
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
  const bracket: Bracket = (BRACKETS.find((b) => b.key === sp.bracket)?.key ?? 'diamond+');

  const data = await apiGet<DetailResponse>(
    `/api/champions/${ddChamp.key}/detail?lane=${lane}&bracket=${encodeURIComponent(bracket)}`,
    { next: { revalidate: 600 } },
  );

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
              href={`/champions/${encodeURIComponent(champion)}?lane=${l.key}&bracket=${encodeURIComponent(bracket)}`}
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
              href={`/champions/${encodeURIComponent(champion)}?lane=${lane}&bracket=${encodeURIComponent(b.key)}`}
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
    </main>
  );
}
