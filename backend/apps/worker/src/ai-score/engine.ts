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

const ALGO_VERSION = 'ai-score@2.0';

// ---- Component LUTs --------------------------------------------------
// Each LUT is sorted descending by raw value. Linear-interpolated between
// adjacent rows; clamped to first/last on either end.

type LUT = ReadonlyArray<readonly [number, number]>;

// Extended top end so deathless / carry games actually differentiate
// (was capped at KDA=6 → 100; perfect 0-death games were indistinguishable
// from a 6-KDA solid game).
const KDA_LUT: LUT = [[12, 100], [9, 95], [6, 88], [4, 78], [3, 68], [2.2, 55], [1.5, 42], [1, 28], [0.5, 12], [0, 0]];
const KP_LUT:  LUT = [[70, 100], [60, 85], [50, 70], [40, 55], [30, 40], [20, 25], [10, 10], [0, 0]];

// CS per minute (jungle counts neutral monsters too)
const CS_LUT_LANER: LUT = [[9, 100], [8, 85], [7, 70], [6, 55], [5, 40], [4, 25], [3, 10], [0, 0]];
const CS_LUT_JUNGLE: LUT = [[6.5, 100], [5.5, 80], [4.5, 60], [3.5, 40], [2.5, 20], [0, 0]];
const CS_LUT_SUPPORT: LUT = [[4, 100], [3, 80], [2, 60], [1, 40], [0.5, 20], [0, 0]];

// Damage to champions, share of team
const DMG_SHARE_LUT: LUT = [[32, 100], [28, 85], [24, 70], [20, 55], [16, 40], [12, 25], [8, 10], [0, 0]];

// Damage taken, share of team (tank metric)
const TAKEN_SHARE_LUT: LUT = [[30, 100], [25, 80], [20, 60], [15, 40], [10, 20], [0, 0]];

// Vision score per minute
const VISION_LUT_LANER:   LUT = [[1.5, 100], [1.2, 80], [1.0, 65], [0.8, 50], [0.6, 35], [0.4, 20], [0, 0]];
const VISION_LUT_JUNGLE:  LUT = [[2.0, 100], [1.6, 80], [1.3, 65], [1.0, 50], [0.7, 35], [0, 0]];
const VISION_LUT_SUPPORT: LUT = [[3.0, 100], [2.5, 85], [2.0, 70], [1.5, 55], [1.0, 40], [0.7, 25], [0, 0]];

// Damage to objectives per minute (jungle metric)
const DMG_OBJ_PM_LUT: LUT = [[800, 100], [600, 80], [400, 60], [250, 40], [150, 25], [50, 10], [0, 0]];

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

const LANE_WEIGHTS: Record<Lane, ComponentWeights> = {
  top:     { kda: 25, kp: 10, cs: 20, dmgShare: 25, takenShare: 10, vision: 10, dmgObj: 0  },
  jungle:  { kda: 25, kp: 15, cs: 10, dmgShare: 15, takenShare: 0,  vision: 15, dmgObj: 20 },
  mid:     { kda: 25, kp: 10, cs: 25, dmgShare: 30, takenShare: 0,  vision: 10, dmgObj: 0  },
  adc:     { kda: 25, kp: 10, cs: 25, dmgShare: 30, takenShare: 0,  vision: 10, dmgObj: 0  },
  support: { kda: 25, kp: 20, cs: 5,  dmgShare: 15, takenShare: 0,  vision: 35, dmgObj: 0  },
};

const GRADE_BANDS: ReadonlyArray<{ min: number; letter: AIScoreResult['letter'] }> = [
  { min: 88, letter: 'S+' }, { min: 78, letter: 'S' }, { min: 66, letter: 'A' },
  { min: 50, letter: 'B' }, { min: 35, letter: 'C' }, { min: 0, letter: 'D' },
];

// ---- Public ----------------------------------------------------------

export function computeAIScore(p: ParsedParticipant, totals: TeamTotals, gameDurationSec: number): AIScoreResult | null {
  if (!p.lane) return null;

  const minutes = Math.max(1, gameDurationSec / 60);
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
