// AI Score — absolute role-weighted LUT scoring (0~100).
//
// Per-match, per-player. No cohort baselines, no historical accumulation —
// every component maps a raw stat through a fixed LUT calibrated against
// rough KR Diamond+ distributions. Weights vary by lane.
//
// MVP/ACE are NOT computed here; they're decided at match level after all 10
// scores are computed (winning-team max = MVP, losing-team max = ACE).

import { ParsedParticipant } from '../parse/match.js';
import { Lane } from '@lol-tracker/shared';

export interface TeamTotals {
  dmgToChampPerMin: { blue: number; red: number };
  damageTakenPerMin: { blue: number; red: number };
}

export interface AIScoreResult {
  score: number;       // 0~100, one decimal
  letter: 'S+' | 'S' | 'A' | 'B' | 'C' | 'D';
  algoVersion: string;
}

const ALGO_VERSION = 'ai-score@3.1';

// ---- Component LUTs --------------------------------------------------
// Each LUT is sorted descending by raw value. Linear-interpolated between
// adjacent rows; clamped to first/last on either end.
//
// Calibrated against actual KR diamond+ patch 16.10 distributions (n≈700k
// matches). The earlier hand-set values gave the median player ~70 score
// across the board; now P50 ≈ 50, P90 ≈ 85, P10 ≈ 15, P99 ≈ 100 — so the
// "absolute, intuition-matching" property holds: 0/10/0 is bad anywhere,
// 10/0/10 is good anywhere, and your median game lands near 50 (not 70).

type LUT = ReadonlyArray<readonly [number, number]>;

// KDA — empirical: P10≈0.64, P50≈2.26, P90≈7.65, P99≈25.
const KDA_LUT: LUT = [[25, 100], [15, 95], [10, 90], [7.5, 85], [5, 75], [3.5, 65], [2.3, 50], [1.5, 33], [0.8, 18], [0.3, 5], [0, 0]];

// Kill participation — empirical: P10≈25, P50≈46, P90≈65 (lane-weighted).
const KP_LUT: LUT = [[85, 100], [70, 90], [60, 75], [46, 50], [35, 30], [25, 15], [10, 5], [0, 0]];

// CS per minute. Laner P50≈7.2/P90≈9.0, jungle P50≈6.5/P90≈8.05,
// support P50≈1.12/P90≈1.85.
const CS_LUT_LANER:   LUT = [[10.5, 100], [9, 90], [8, 72], [7.2, 50], [6, 28], [5, 15], [4, 8], [3, 3], [0, 0]];
const CS_LUT_JUNGLE:  LUT = [[8.5, 100], [7.5, 88], [6.5, 50], [5.5, 25], [4.5, 13], [3.5, 6], [2.5, 2], [0, 0]];
const CS_LUT_SUPPORT: LUT = [[3, 100], [2, 80], [1.2, 50], [0.7, 25], [0.3, 10], [0, 0]];

// Damage to champions, share of team. Lane-agnostic LUT; support weight is
// low so the support tail (median ~10%) doesn't tank their score.
// P10≈11, P50≈19, P90≈28 across damage dealers.
const DMG_SHARE_LUT: LUT = [[40, 100], [32, 90], [28, 80], [24, 65], [19, 50], [14, 30], [9, 15], [5, 5], [0, 0]];

// Damage taken, share of team — used only for top (10% weight). Top P50≈23.2,
// P90≈30.
const TAKEN_SHARE_LUT: LUT = [[35, 100], [30, 90], [25, 70], [23, 50], [18, 25], [13, 10], [0, 0]];

// Vision per minute. Lane structurally differs: support P50≈2.71/P90≈3.57,
// jungle P50≈1.06/P90≈1.54, laner P50≈0.75/P90≈1.1.
const VISION_LUT_LANER:   LUT = [[1.8, 100], [1.5, 90], [1.1, 80], [0.75, 50], [0.5, 25], [0.3, 10], [0, 0]];
const VISION_LUT_JUNGLE:  LUT = [[2.2, 100], [1.8, 90], [1.55, 80], [1.06, 50], [0.7, 25], [0.4, 10], [0, 0]];
const VISION_LUT_SUPPORT: LUT = [[4.5, 100], [3.8, 90], [3.6, 80], [2.71, 50], [2.0, 25], [1.4, 10], [0, 0]];

// Damage to objectives per minute — jungle-weighted only.
// Jungle P50≈842, P90≈1664.
const DMG_OBJ_PM_LUT: LUT = [[2200, 100], [1700, 90], [1300, 75], [842, 50], [550, 25], [300, 12], [100, 3], [0, 0]];

// ---- Lane weights (must sum to 100) ----------------------------------

interface ComponentWeights {
  kda: number;
  kp: number;
  cs: number;
  dmgShare: number;
  takenShare: number;
  vision: number;
  dmgObj: number;
}

// Lane weights. Support CS dropped from 5 → 0 (supports legitimately have
// low CS, scoring it adds noise) and KP picked up the slack.
const LANE_WEIGHTS: Record<Lane, ComponentWeights> = {
  top:     { kda: 25, kp: 10, cs: 20, dmgShare: 25, takenShare: 10, vision: 10, dmgObj: 0  },
  jungle:  { kda: 25, kp: 15, cs: 10, dmgShare: 15, takenShare: 0,  vision: 15, dmgObj: 20 },
  mid:     { kda: 25, kp: 10, cs: 25, dmgShare: 30, takenShare: 0,  vision: 10, dmgObj: 0  },
  adc:     { kda: 25, kp: 10, cs: 25, dmgShare: 30, takenShare: 0,  vision: 10, dmgObj: 0  },
  support: { kda: 25, kp: 25, cs: 0,  dmgShare: 15, takenShare: 0,  vision: 35, dmgObj: 0  },
};

const GRADE_BANDS: ReadonlyArray<{ min: number; letter: AIScoreResult['letter'] }> = [
  { min: 88, letter: 'S+' }, { min: 78, letter: 'S' }, { min: 66, letter: 'A' },
  { min: 50, letter: 'B' }, { min: 35, letter: 'C' }, { min: 0, letter: 'D' },
];

// ---- Public ----------------------------------------------------------

export function computeAIScore(p: ParsedParticipant, totals: TeamTotals, gameDurationSec: number): AIScoreResult | null {
  if (!p.lane) return null;

  const minutes = Math.max(1, gameDurationSec / 60);
  // Sub-12-minute games are typically remakes / early surrenders where every
  // per-minute metric is noise. Skip rather than dilute the cache with garbage.
  if (minutes < 12) return null;
  const w = LANE_WEIGHTS[p.lane];

  // Floor deaths at 0.5 for true 0-death games so a "perfect game" gets
  // recognized (vs 6/0/4 and 12/0/8 both reading as KDA 10 with deaths=1
  // floor). Then hard-cap the ratio at 15 so absurd outliers (25/0/15 etc.)
  // don't blow past the LUT's documented top.
  const kdaRatio = Math.min(15, (p.kills + p.assists) / Math.max(0.5, p.deaths));
  const csPerMin = p.cs / minutes;
  const visionPm = p.visionScore / minutes;
  const dmgObjPm = p.dmgToObj / minutes;
  const teamDmg = totals.dmgToChampPerMin[p.team];
  const teamTaken = totals.damageTakenPerMin[p.team];
  const dmgShare = teamDmg > 0 ? (p.dmgToChampPerMin / teamDmg) * 100 : 0;
  const takenShare = teamTaken > 0 ? (p.damageTakenPerMin / teamTaken) * 100 : 0;

  const csLut = p.lane === 'jungle' ? CS_LUT_JUNGLE
              : p.lane === 'support' ? CS_LUT_SUPPORT
              : CS_LUT_LANER;
  const visionLut = p.lane === 'jungle' ? VISION_LUT_JUNGLE
                  : p.lane === 'support' ? VISION_LUT_SUPPORT
                  : VISION_LUT_LANER;

  const componentScores = {
    kda:        lutScore(kdaRatio, KDA_LUT),
    kp:         lutScore(p.kp ?? 0, KP_LUT),
    cs:         lutScore(csPerMin, csLut),
    dmgShare:   lutScore(dmgShare, DMG_SHARE_LUT),
    takenShare: lutScore(takenShare, TAKEN_SHARE_LUT),
    vision:     lutScore(visionPm, VISION_LUT_LANER === visionLut ? VISION_LUT_LANER : visionLut),
    dmgObj:     lutScore(dmgObjPm, DMG_OBJ_PM_LUT),
  };

  // Weighted sum (weights sum to 100, scores 0~100 → result 0~100)
  let score = 0;
  for (const k of Object.keys(componentScores) as Array<keyof typeof componentScores>) {
    score += componentScores[k] * w[k] / 100;
  }

  // Additive skill / impact bonus, capped at +10. Recognizes plays that
  // don't show up in per-minute averages — solo kills, first blood, first
  // tower, objective secures. Designed so a typical game contributes 0–3
  // and a true carry-impact game contributes 5–10.
  const skillBonus =
      Math.min(5,   (p.soloKills ?? 0) * 1.5)                        // up to +5
    + (p.firstBloodKill ? 2 : p.firstBloodAssist ? 1 : 0)            // up to +2
    + (p.firstTowerKill ? 1.5 : 0)                                   // up to +1.5
    + Math.min(2,   ((p.dragonTakedowns ?? 0) + (p.baronTakedowns ?? 0)) * 0.3); // up to +2
  score = Math.min(100, score + Math.min(10, skillBonus));

  return {
    score: Math.round(score * 10) / 10,
    letter: letterGrade(score),
    algoVersion: ALGO_VERSION,
  };
}

/** Compute team-level totals once per match — pass to computeAIScore for each player. */
export function teamTotalsFrom(participants: ParsedParticipant[]): TeamTotals {
  const totals: TeamTotals = {
    dmgToChampPerMin: { blue: 0, red: 0 },
    damageTakenPerMin: { blue: 0, red: 0 },
  };
  for (const p of participants) {
    totals.dmgToChampPerMin[p.team] += p.dmgToChampPerMin;
    totals.damageTakenPerMin[p.team] += p.damageTakenPerMin;
  }
  return totals;
}

// ---- helpers ---------------------------------------------------------

function lutScore(value: number, lut: LUT): number {
  if (!isFinite(value) || value <= (lut[lut.length - 1]?.[0] ?? 0)) return lut[lut.length - 1]?.[1] ?? 0;
  if (value >= (lut[0]?.[0] ?? 0)) return lut[0]?.[1] ?? 0;
  for (let i = 0; i < lut.length - 1; i++) {
    const hi = lut[i]!;
    const lo = lut[i + 1]!;
    if (value <= hi[0] && value >= lo[0]) {
      const span = hi[0] - lo[0];
      if (span === 0) return hi[1];
      const t = (value - lo[0]) / span;
      return lo[1] + t * (hi[1] - lo[1]);
    }
  }
  return 0;
}

function letterGrade(score: number): AIScoreResult['letter'] {
  for (const b of GRADE_BANDS) if (score >= b.min) return b.letter;
  return 'D';
}
