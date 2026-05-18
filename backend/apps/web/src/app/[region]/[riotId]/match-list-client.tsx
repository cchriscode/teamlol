'use client';

import { useState, useEffect } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import type { MatchListItem } from '@/lib/api-types-summoner';

interface Props {
  matches: MatchListItem[];
  selfPuuid: string;
  version: string;
  championNameByKey: Record<string, string>;
  region: string;
  cold?: boolean;
}

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}
function timeAgo(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const m = Math.floor(sec / 60); if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function MatchListClient({ matches, selfPuuid, version, championNameByKey, cold }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (matches.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        {cold ? '데이터 수집 중입니다. 잠시 후 새로고침하세요.' : '아직 수집된 매치가 없습니다.'}
      </div>
    );
  }

  return (
    <>
      {matches.map((m) => {
        const s = m.self;
        const kda = s.deaths === 0 ? s.kills + s.assists : (s.kills + s.assists) / s.deaths;
        const minutes = Math.floor(m.gameDuration / 60);
        const seconds = m.gameDuration % 60;
        const cspm = m.gameDuration > 0 ? s.cs / (m.gameDuration / 60) : 0;
        const isOpen = expandedId === m.matchId;

        const blueParts = (m.participants ?? []).filter((p) => p.team === 'blue');
        const redParts  = (m.participants ?? []).filter((p) => p.team === 'red');

        return (
          <div key={m.matchId}>
            <div
              role="button"
              tabIndex={0}
              className={`match-card${s.win ? ' win' : ''}${isOpen ? ' open' : ''}`}
              onClick={() => setExpandedId(isOpen ? null : m.matchId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isOpen ? null : m.matchId); } }}
            >
              <div className={`match-result${s.win ? ' win' : ''}`}>
                <div className="match-result-label">{s.win ? '승리' : '패배'}</div>
                <div className="match-meta">
                  솔로랭크<br />
                  {timeAgo(m.gameCreation)}<br />
                  {minutes}분 {seconds}초
                </div>
              </div>
              <div className="match-champ-section">
                <div className="match-champ-icon-wrap">
                  <ChampionIcon championKey={s.championKey} size={48} version={version} alt={championNameByKey[s.championKey] ?? s.championKey} />
                  <div className="match-position-badge">{laneKr(s.lane)}</div>
                </div>
              </div>
              <div className="match-stats">
                <div className="match-kda">{s.kills} / {s.deaths} / {s.assists} <span className="match-kda-ratio">(KDA {kda.toFixed(2)})</span></div>
                <div className="match-substats">CS {s.cs} ({cspm.toFixed(1)}/분) · 시야 {s.visionScore}</div>
                <div className="match-items">
                  {s.items.map((id, i) => id > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} className="item-icon" src={ddragon.itemIcon(id, version)} width={22} height={22} alt="" />
                  ) : null)}
                </div>
              </div>
              <div className="match-score-box">
                <div className="match-score-label">AI Score</div>
                <div className={`match-score-value${s.aiScore != null && s.aiScore >= 60 ? ' high' : s.aiScore != null && s.aiScore <= 40 ? ' low' : ''}`}>
                  {s.aiScore?.toFixed(0) ?? '—'}
                </div>
                {s.aiScoreLetter && (
                  <div style={{ fontSize: 10, marginTop: 2 }}>{s.aiScoreLetter}</div>
                )}
              </div>
              {m.participants && m.participants.length === 10 && (
                <div className="match-teams">
                  <div className="match-teams-grid">
                    {[blueParts, redParts].map((team, idx) => (
                      <div key={idx} className="match-teams-col">
                        <div className="team-label">{idx === 0 ? '블루팀' : '레드팀'}</div>
                        {team.map((p) => (
                          <div key={p.puuid} className={`player${p.puuid === selfPuuid ? ' is-self' : ''}`}>
                            <ChampionIcon championKey={p.championKey} size={14} alt="" />
                            <span className="player-name">{p.nameKr ?? p.gameName ?? p.puuid.slice(0, 6)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="match-expand" aria-label={isOpen ? '접기' : '펼치기'}>{isOpen ? '▴' : '▾'}</div>
            </div>

            {isOpen && m.participants && m.participants.length === 10 && (
              <ExpandPanel
                match={m}
                blueParts={blueParts}
                redParts={redParts}
                selfPuuid={selfPuuid}
                version={version}
                championNameByKey={championNameByKey}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// ---- Expand panel: tabs (기본 분석 / 시간대별 분석) -------------------
// Replaces the original prototype's three-tab panel. "빌드" tab is a follow-
// up; timeline tab fetches `/api/match/:id/timeline-summary` lazily so
// expanding a card doesn't pay the cost until you click into the chart.
type Tab = 'basic' | 'timeline';

type Participant = NonNullable<MatchListItem['participants']>[number];

interface ExpandPanelProps {
  match: MatchListItem;
  blueParts: Participant[];
  redParts: Participant[];
  selfPuuid: string;
  version: string;
  championNameByKey: Record<string, string>;
}

function ExpandPanel({ match: m, blueParts, redParts, selfPuuid, version, championNameByKey }: ExpandPanelProps) {
  const [tab, setTab] = useState<Tab>('basic');

  return (
    <div className="match-expand-panel-wrap card">
      <div className="expand-tabs" role="tablist">
        {([
          { k: 'basic', label: '기본 분석' },
          { k: 'timeline', label: '시간대별 분석' },
        ] as Array<{ k: Tab; label: string }>).map((t) => (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={tab === t.k}
            className={`expand-tab${tab === t.k ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setTab(t.k); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'basic' && (
        <div className="match-expand-panel" onClick={(e) => e.stopPropagation()}>
          {[blueParts, redParts].map((team, idx) => (
            <div key={idx} className={`match-detail-team team-${idx === 0 ? 'blue' : 'red'}`}>
              <div className="match-detail-team-header">
                {idx === 0 ? '블루팀' : '레드팀'} {team[0]?.win ? '승리' : '패배'}
              </div>
              {team.map((p) => {
                const pkda = (p.deaths ?? 0) === 0
                  ? ((p.kills ?? 0) + (p.assists ?? 0))
                  : ((p.kills ?? 0) + (p.assists ?? 0)) / (p.deaths ?? 1);
                return (
                  <div key={p.puuid} className={`match-detail-row${p.puuid === selfPuuid ? ' is-self' : ''}`}>
                    <ChampionIcon championKey={p.championKey} size={28} version={version} alt={championNameByKey[p.championKey] ?? p.championKey} />
                    <div className="match-detail-name">
                      <div className="name-line">
                        {p.nameKr ?? p.gameName ?? p.puuid.slice(0, 8)}
                        {p.tagLine && <span className="text-tertiary"> #{p.tagLine}</span>}
                      </div>
                      <div className="text-tertiary" style={{ fontSize: 10 }}>{laneKr(p.lane ?? '')}</div>
                    </div>
                    <div className="match-detail-kda">
                      {p.kills}/{p.deaths}/{p.assists}
                      <span className="text-tertiary" style={{ marginLeft: 4 }}>({pkda.toFixed(2)})</span>
                    </div>
                    <div className="match-detail-cs">
                      CS {p.cs ?? 0}
                      <span className="text-tertiary" style={{ marginLeft: 4 }}>({(p.csPerMin ?? 0).toFixed(1)}/분)</span>
                    </div>
                    <div className="match-detail-items">
                      {(p.items ?? []).map((id, i) => id > 0 ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} className="item-icon" src={ddragon.itemIcon(id, version)} width={20} height={20} alt="" />
                      ) : null)}
                    </div>
                    <div className="match-detail-score">
                      {p.aiScore != null ? p.aiScore.toFixed(0) : '—'}
                      {p.aiScoreLetter && <span className="text-tertiary" style={{ marginLeft: 4 }}>{p.aiScoreLetter}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {tab === 'timeline' && (
        <TimelineTab matchId={m.matchId} duration={m.gameDuration} />
      )}
    </div>
  );
}

// ---- Timeline tab: lazy fetch + SVG line charts ----------------------
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface TimelineFrame {
  ts: number;
  blue: { totalGold: number; totalXp: number; kills: number };
  red:  { totalGold: number; totalXp: number; kills: number };
}
interface TimelineResp {
  frames: TimelineFrame[];
  events: Array<{ ts: number; type: string; teamId?: number }>;
}

function TimelineTab({ matchId, duration }: { matchId: string; duration: number }) {
  const [data, setData] = useState<TimelineResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/match/${encodeURIComponent(matchId)}/timeline-summary`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('no timeline')))
      .then((j) => { if (alive) setData(j as TimelineResp); })
      .catch((e) => { if (alive) setError(e.message ?? '오류'); });
    return () => { alive = false; };
  }, [matchId]);

  if (error) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>타임라인 데이터 없음</div>;
  if (!data) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>로딩 중...</div>;
  if (data.frames.length < 2) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>타임라인 표본 부족</div>;

  return (
    <div className="expand-timeline-stack" onClick={(e) => e.stopPropagation()}>
      <TimelineChart
        title="팀 골드"
        frames={data.frames}
        getValue={(f) => ({ blue: f.blue.totalGold, red: f.red.totalGold })}
        duration={duration}
      />
      <TimelineChart
        title="팀 경험치"
        frames={data.frames}
        getValue={(f) => ({ blue: f.blue.totalXp, red: f.red.totalXp })}
        duration={duration}
      />
      <TimelineChart
        title="팀 골드 격차 (블루 − 레드)"
        frames={data.frames}
        getValue={(f) => ({ blue: f.blue.totalGold - f.red.totalGold, red: 0 })}
        duration={duration}
        showRed={false}
        signed
      />
    </div>
  );
}

interface ChartProps {
  title: string;
  frames: TimelineFrame[];
  getValue: (f: TimelineFrame) => { blue: number; red: number };
  duration: number;
  showRed?: boolean;
  signed?: boolean;
}
function TimelineChart({ title, frames, getValue, duration, showRed = true, signed = false }: ChartProps) {
  const W = 720, H = 180, PAD = { l: 50, r: 16, t: 18, b: 28 };
  const blueVals = frames.map((f) => getValue(f).blue);
  const redVals  = frames.map((f) => getValue(f).red);
  const allVals  = showRed ? [...blueVals, ...redVals] : blueVals;
  const maxV = Math.max(...allVals, 1);
  const minV = signed ? Math.min(...allVals, -1) : 0;
  const yRange = maxV - minV || 1;
  const xScale = (ts: number) => PAD.l + (ts / Math.max(1, duration)) * (W - PAD.l - PAD.r);
  const yScale = (v: number) => H - PAD.b - ((v - minV) / yRange) * (H - PAD.t - PAD.b);
  const linePath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(frames[i].ts).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');

  // x-axis minute ticks (5 min steps, fewer if short game)
  const step = duration > 1800 ? 300 : 180;
  const xTicks: number[] = [];
  for (let s = 0; s <= duration; s += step) xTicks.push(s);

  // y-axis: 4 ticks
  const yTicks: number[] = [];
  for (let i = 0; i <= 4; i++) yTicks.push(minV + (yRange * i) / 4);
  const fmt = (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

  return (
    <div className="expand-chart">
      <div className="expand-chart-title-row">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* zero line for signed charts */}
        {signed && (
          <line x1={PAD.l} x2={W - PAD.r} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {/* y grid + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={PAD.l - 6} y={yScale(v) + 3} fontSize="9" fill="var(--text-tertiary)" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((s) => (
          <text key={s} x={xScale(s)} y={H - 10} fontSize="9" fill="var(--text-tertiary)" textAnchor="middle">
            {Math.round(s / 60)}분
          </text>
        ))}
        {/* lines */}
        <path d={linePath(blueVals)} fill="none" stroke="var(--color-win)" strokeWidth="2" />
        {showRed && <path d={linePath(redVals)} fill="none" stroke="var(--color-loss)" strokeWidth="2" />}
      </svg>
    </div>
  );
}
