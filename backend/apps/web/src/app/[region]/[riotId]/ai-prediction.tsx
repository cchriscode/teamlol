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
}

const TIER_NAME: Record<string, string> = {
  IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘',
  EMERALD: '에메랄드', DIAMOND: '다이아', MASTER: '마스터', GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저',
};

function tierFromScore(avg: number): string {
  if (avg >= 85) return 'CHALLENGER';
  if (avg >= 78) return 'GRANDMASTER';
  if (avg >= 70) return 'MASTER';
  if (avg >= 60) return 'DIAMOND';
  if (avg >= 50) return 'EMERALD';
  if (avg >= 42) return 'PLATINUM';
  if (avg >= 34) return 'GOLD';
  if (avg >= 26) return 'SILVER';
  if (avg >= 18) return 'BRONZE';
  return 'IRON';
}

export function AIPredictionBadges({ matches, selfPuuid, currentTier }: Props) {
  const scored = matches.filter((m) => m.self.aiScore != null);
  if (scored.length < 5) {
    return null;       // need at least 5 games before any prediction is meaningful
  }

  const avgScore = scored.reduce((s, m) => s + (m.self.aiScore ?? 0), 0) / scored.length;
  const predictedTier = tierFromScore(avgScore);

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
            <span className={`tier-badge tier-${currentTier.toLowerCase()}`}>{TIER_NAME[currentTier] ?? currentTier}</span>
          )}
          <span className="ai-prediction-arrow">→</span>
          <span className={`tier-badge tier-${predictedTier.toLowerCase()}`}>{TIER_NAME[predictedTier]}</span>
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
