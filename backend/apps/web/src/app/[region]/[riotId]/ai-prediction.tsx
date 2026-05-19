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

// AI Score is an absolute LUT — a 10/0/5 stomp earns the same number in
// Iron as in Challenger. But the AVERAGE Iron player puts up much higher
// numbers than the average Challenger because opponents are easier. So
// "absolute score → absolute tier" over-predicts at low tiers.
//
// Relative prediction: baseline expected score per tier (≈ what the median
// player at that tier averages). Player's actual avg − baseline = delta.
// Positive delta → climbing; negative → demoting.
//
// Baselines are calibrated heuristics — replace with empirical SELECT
// AVG(ai_score_cached) GROUP BY tier once we have enough samples.
const TIER_BASELINE: Record<string, number> = {
  IRON: 62, BRONZE: 58, SILVER: 54, GOLD: 51, PLATINUM: 49,
  EMERALD: 48, DIAMOND: 47, MASTER: 45, GRANDMASTER: 43, CHALLENGER: 41,
};

// Ordered low → high for shift arithmetic.
const TIER_ORDER = [
  'IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM',
  'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER',
] as const;
const DIVISIONED_TIERS = new Set(['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND']);
const RANK_ORDER = ['IV', 'III', 'II', 'I'] as const;     // low → high
type Rank = typeof RANK_ORDER[number];

// 4-division ladder index. Master/GM/Challenger each occupy one position
// (no divisions) — we treat them as a single divisional step each so the
// shift math stays linear.
function ladderIndex(tier: string, rank?: string | null): number {
  const tIdx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number]);
  if (tIdx < 0) return 0;
  if (!DIVISIONED_TIERS.has(tier)) {
    // Position past Diamond I = master+ tiers, one slot each.
    return TIER_ORDER.indexOf('DIAMOND') * 4 + 4 + (tIdx - TIER_ORDER.indexOf('MASTER'));
  }
  const rIdx = rank ? RANK_ORDER.indexOf(rank as Rank) : 0;
  return tIdx * 4 + Math.max(0, rIdx);
}

function fromLadderIndex(idx: number): { tier: string; rank?: Rank } {
  const diamondMax = TIER_ORDER.indexOf('DIAMOND') * 4 + 3;          // Diamond I
  if (idx <= diamondMax) {
    const tIdx = Math.max(0, Math.min(TIER_ORDER.indexOf('DIAMOND'), Math.floor(idx / 4)));
    const rIdx = Math.max(0, Math.min(3, idx - tIdx * 4));
    return { tier: TIER_ORDER[tIdx], rank: RANK_ORDER[rIdx] };
  }
  const masterIdx = idx - diamondMax - 1;                            // 0=Master, 1=GM, 2=Challenger
  const tierName = ['MASTER', 'GRANDMASTER', 'CHALLENGER'][Math.min(2, masterIdx)];
  return { tier: tierName };
}

// Each ±3 AI-score points away from baseline = ±1 division shift.
// Clamped to ±4 divisions (one full tier) so the prediction stays
// believable — e.g. E4 can rise to D4 at most, fall to P4 at worst.
const POINTS_PER_DIVISION = 3;
const MAX_SHIFT = 4;

function predictFromCurrent(currentTier: string, currentRank: string | null | undefined, avgScore: number): { tier: string; rank?: Rank; shift: number } {
  const baseline = TIER_BASELINE[currentTier] ?? 50;
  const rawShift = (avgScore - baseline) / POINTS_PER_DIVISION;
  const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, Math.round(rawShift)));
  const curIdx = ladderIndex(currentTier, currentRank);
  const maxIdx = ladderIndex('CHALLENGER');
  const newIdx = Math.max(0, Math.min(maxIdx, curIdx + shift));
  return { ...fromLadderIndex(newIdx), shift };
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
  // Unranked players have no baseline — hide the prediction (we can't tell
  // them anything meaningful without knowing their starting tier).
  if (!currentTier) return null;
  const predicted = predictFromCurrent(currentTier, currentRank, avgScore);

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
          {predicted.shift !== 0 && ` (${predicted.shift > 0 ? '+' : ''}${predicted.shift}디비전)`}
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
