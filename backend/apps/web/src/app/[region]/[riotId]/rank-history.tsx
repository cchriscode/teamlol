// Server component — pure SVG render of tier-progression dots + LP trend.
// Data is fetched by the parent page (and bundled into its parallel fetch
// batch) so this component is purely presentational.

export interface RankPoint {
  snapshotDate: string;     // YYYY-MM-DD
  tier: string;
  rank: string;
  lp: number;
  wins: number;
  losses: number;
}

const TIER_ORDER: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};
const TIER_SHORT: Record<string, string> = {
  IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
  EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'CH',
};
const RANK_ORDER: Record<string, number> = { I: 3, II: 2, III: 1, IV: 0 };

// Map a tier+rank+lp to an "absolute LP" so we can chart across divisions.
// 100 LP per division × 4 divisions per tier = 400 LP per tier.
function absLp(tier: string, rank: string, lp: number): number {
  const t = TIER_ORDER[tier] ?? 0;
  // Master+ has no divisions; lp is unbounded above 0.
  if (tier === 'MASTER' || tier === 'GRANDMASTER' || tier === 'CHALLENGER') {
    return t * 400 + lp;
  }
  const r = RANK_ORDER[rank] ?? 0;
  return t * 400 + r * 100 + lp;
}

interface Props {
  history: RankPoint[];
  days?: number;
}

export function RankHistoryCard({ history, days = 30 }: Props) {
  const points = history;
  if (points.length < 2) {
    return null;       // not enough history yet — hide instead of empty chart
  }

  // Recent climb dots — last 5 distinct tier+rank changes.
  const changes: RankPoint[] = [];
  let prevKey = '';
  for (const p of points) {
    const k = `${p.tier}|${p.rank}`;
    if (k !== prevKey) { changes.push(p); prevKey = k; }
  }
  const recent = changes.slice(-5);

  // SVG line chart geometry.
  const W = 320, H = 110, PAD = { l: 6, r: 6, t: 8, b: 18 };
  const xs = points.map((_, i) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r));
  const vals = points.map((p) => absLp(p.tier, p.rank, p.lp));
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const range = Math.max(1, maxV - minV);
  const yScale = (v: number) => PAD.t + (1 - (v - minV) / range) * (H - PAD.t - PAD.b);
  const linePath = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xs[i].toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');

  // LP delta over the window
  const first = vals[0], last = vals[vals.length - 1];
  const delta = last - first;
  const deltaCls = delta > 0 ? 'text-positive' : delta < 0 ? 'text-loss' : 'text-tertiary';

  // Top tier reached
  const peakLp = Math.max(...vals);
  const peak = points.find((p) => absLp(p.tier, p.rank, p.lp) === peakLp);

  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="section-title" style={{ marginBottom: 8 }}>
        <span>최근 {days}일 <span className={deltaCls}>{delta > 0 ? '▲' : delta < 0 ? '▼' : '━'}{Math.abs(delta)} LP</span></span>
        {peak && (
          <span className="meta">최고티어: {TIER_SHORT[peak.tier]}{peak.rank}-{peak.lp}</span>
        )}
      </div>

      {/* Progression dots */}
      <div className="rank-progression-row">
        {recent.map((p, i) => (
          <div key={i} className={`rank-progression-dot tier-${p.tier.toLowerCase()}${i === recent.length - 1 ? ' current' : ''}`}>
            {TIER_SHORT[p.tier]}{p.rank !== '' && p.rank !== 'I' && p.rank !== 'II' && p.rank !== 'III' && p.rank !== 'IV' ? '' : p.rank}
          </div>
        ))}
      </div>

      {/* LP line chart */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 6 }}>
        <path d={linePath} fill="none" stroke="var(--color-win)" strokeWidth="1.5" />
        {/* dots at each sample */}
        {points.map((p, i) => (
          <circle key={i} cx={xs[i]} cy={yScale(vals[i])} r="2" fill="var(--color-win)" />
        ))}
        {/* x-axis: first / mid / last labels */}
        {[0, Math.floor(points.length / 2), points.length - 1].map((idx) => (
          <text key={idx} x={xs[idx]} y={H - 4} fontSize="9" fill="var(--text-tertiary)" textAnchor="middle">
            {points[idx].snapshotDate.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}
