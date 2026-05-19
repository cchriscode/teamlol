// AI tier prediction + team-luck badges.
// Server-side pure-compute from the recent matches the page already has.
//
// AI tier prediction: maps the player's average AI Score (over recent
// games) into a predicted tier band. Calibrated against the broader
// score distribution — P50 ≈ 50 lands around Emerald/Diamond, P90 ≈ 85
// around Challenger, P10 ≈ 15 around Iron.
//
// Team luck: compares the player's average AI Score against the average
// AI Score of their FOUR teammates across the same games. If teammates
// underperform relative to the player on losses, "팀운 나쁨"; if they
// over-perform on wins, "팀운 좋음". Reports a percentile-ish bucket.

import type { MatchListItem } from '@/lib/api-types-summoner';

interface Props {
  matches: MatchListItem[];
  selfPuuid: string;
  currentTier?: string | null;
  currentRank?: string | null;
}

const TIER_NAME: Record<string, string> = {
  IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘',
  EMERALD: '에메랄드', DIAMOND: '다이아', MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저',
};
const TIER_SHORT: Record<string, string> = {
  IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
  EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'CH',
};

// Tier bands cover ~8 points each; within a divisioned tier we split the
// band into four 2pt buckets that correspond to IV / III / II / I.
const TIER_BANDS: Array<{ min: number; tier: string; divisioned: boolean }> = [
  { min: 85, tier: 'CHALLENGER',   divisioned: false },
  { min: 78, tier: 'GRANDMASTER',  divisioned: false },
  { min: 70, tier: 'MASTER',       divisioned: false },
  { min: 62, tier: 'DIAMOND',      divisioned: true },
  { min: 54, tier: 'EMERALD',      divisioned: true },
  { min: 46, tier: 'PLATINUM',     divisioned: true },
  { min: 38, tier: 'GOLD',         divisioned: true },
  { min: 30, tier: 'SILVER',       divisioned: true },
  { min: 22, tier: 'BRONZE',       divisioned: true },
  { min: 0,  tier: 'IRON',         divisioned: true },
];

function divisionFromBucket(score: number, bandMin: number, bandMax: number): 'IV' | 'III' | 'II' | 'I' {
  const t = (score - bandMin) / Math.max(0.0001, bandMax - bandMin);
  if (t >= 0.75) return 'I';
  if (t >= 0.50) return 'II';
  if (t >= 0.25) return 'III';
  return 'IV';
}

function tierFromScore(avg: number): { tier: string; rank?: 'I' | 'II' | 'III' | 'IV' } {
  for (let i = 0; i < TIER_BANDS.length; i++) {
    const b = TIER_BANDS[i];
    if (avg >= b.min) {
      if (!b.divisioned) return { tier: b.tier };
      const next = i === 0 ? 100 : TIER_BANDS[i - 1].min;       // upper bound = next-tier floor
      return { tier: b.tier, rank: divisionFromBucket(avg, b.min, next) };
    }
  }
  return { tier: 'IRON', rank: 'IV' };
}

function tierLabel(tier: string, rank?: string): string {
  if (rank) return `${TIER_SHORT[tier] ?? tier}${rank === 'I' ? '1' : rank === 'II' ? '2' : rank === 'III' ? '3' : '4'}`;
  return TIER_NAME[tier] ?? tier;
}

export function AIPredictionBadges({ matches, selfPuuid, currentTier, currentRank }: Props) {
  const scored = matches.filter((m) => m.self.aiScore != null);
  if (scored.length < 5) {
    return null;       // need at least 5 games before any prediction is meaningful
  }

  const avgScore = scored.reduce((s, m) => s + (m.self.aiScore ?? 0), 0) / scored.length;
  const predicted = tierFromScore(avgScore);

  // Team luck: average AI score of THIS player's 4 teammates per match,
  // weighted by win/loss. If you carry losses (your score high, team low) → 팀운 나쁨.
  let teamLuckSamples = 0;
  let teamLuckSum = 0;
  for (const m of scored) {
    const me = m.self;
    if (me.aiScore == null) continue;
    const teamMates = (m.participants ?? []).filter(
      (p) => p.team === me.team && p.puuid !== selfPuuid && p.aiScore != null,
    );
    if (teamMates.length === 0) continue;
    const teamAvg = teamMates.reduce((s, p) => s + (p.aiScore ?? 0), 0) / teamMates.length;
    // Negative number when teammates underperformed relative to you.
    // Inverted: my_score - teammate_score. Sign with win/loss: losses where
    // you outscored team count more (you carried but lost).
    const diff = me.aiScore - teamAvg;
    const weight = me.win ? 0.7 : 1.3;       // losses weigh harder
    teamLuckSum += diff * weight;
    teamLuckSamples += weight;
  }
  const teamLuckAvg = teamLuckSamples > 0 ? teamLuckSum / teamLuckSamples : 0;
  // Map diff (≈ -30 to +30 in practice) into a 0~100 luck percentile.
  // Negative diff (you carried, teammates didn't) = bad luck → low percentile.
  const luckPct = Math.max(0, Math.min(100, Math.round(50 - teamLuckAvg * 1.5)));
  const luckLabel = luckPct >= 75 ? '좋음' : luckPct >= 55 ? '평균이상' : luckPct >= 35 ? '보통' : luckPct >= 15 ? '나쁨' : '매우 나쁨';

  return (
    <div className="ai-prediction-row">
      <div className="ai-prediction-card">
        <div className="ai-prediction-label">AI 티어 예측</div>
        <div className="ai-prediction-tiers">
          {currentTier && (
            <span className={`tier-badge tier-${currentTier.toLowerCase()}`}>
              {tierLabel(currentTier, currentRank ?? undefined)}
            </span>
          )}
          <span className="ai-prediction-arrow">→</span>
          <span className={`tier-badge tier-${predicted.tier.toLowerCase()}`}>
            {tierLabel(predicted.tier, predicted.rank)}
          </span>
        </div>
        <div className="text-tertiary" style={{ fontSize: 10 }}>
          최근 {scored.length}게임 평균 AI {avgScore.toFixed(1)}점
        </div>
      </div>
      <div className="ai-prediction-card">
        <div className="ai-prediction-label">팀운</div>
        <div className="ai-prediction-luck">
          <span className={`luck-pill luck-${luckLabel === '좋음' || luckLabel === '평균이상' ? 'good' : luckLabel === '보통' ? 'neutral' : 'bad'}`}>
            {luckLabel}
          </span>
          <span className="text-tertiary" style={{ fontSize: 11 }}>
            (상위 {100 - luckPct}%)
          </span>
        </div>
        <div className="text-tertiary" style={{ fontSize: 10 }}>
          팀원 대비 평균 {teamLuckAvg > 0 ? '+' : ''}{teamLuckAvg.toFixed(1)}점
        </div>
      </div>
    </div>
  );
}
