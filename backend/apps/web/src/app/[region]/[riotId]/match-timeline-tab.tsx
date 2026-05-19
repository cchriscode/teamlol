'use client';

// Timeline tab — lazy fetch + SVG line charts for team gold / xp / gold diff.
// Extracted from match-list-client.tsx so it's dynamic-imported and excluded
// from the initial summoner-page client bundle.

import { useState, useEffect } from 'react';

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

export default function TimelineTab({ matchId, duration }: { matchId: string; duration: number }) {
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

  const step = duration > 1800 ? 300 : 180;
  const xTicks: number[] = [];
  for (let s = 0; s <= duration; s += step) xTicks.push(s);

  const yTicks: number[] = [];
  for (let i = 0; i <= 4; i++) yTicks.push(minV + (yRange * i) / 4);
  const fmt = (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

  return (
    <div className="expand-chart">
      <div className="expand-chart-title-row">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {signed && (
          <line x1={PAD.l} x2={W - PAD.r} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={PAD.l - 6} y={yScale(v) + 3} fontSize="9" fill="var(--text-tertiary)" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {xTicks.map((s) => (
          <text key={s} x={xScale(s)} y={H - 10} fontSize="9" fill="var(--text-tertiary)" textAnchor="middle">
            {Math.round(s / 60)}분
          </text>
        ))}
        <path d={linePath(blueVals)} fill="none" stroke="var(--color-win)" strokeWidth="2" />
        {showRed && <path d={linePath(redVals)} fill="none" stroke="var(--color-loss)" strokeWidth="2" />}
      </svg>
    </div>
  );
}
