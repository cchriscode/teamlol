// @ts-nocheck
/**
 * tier-engine.ts — Champion tier scoring (PS Score + helpers).
 *
 * Spec: docs/tier-spec.md
 * Inputs: PickData.TIER_DATA, TIER_DATA_PREV, TIER_AVG_WR
 * Outputs: rows with PS score, letter tier, trend, honey-champ score
 *
 * Design:
 *  - Wilson lower bound for winrate (95% CI) → small-sample noise control
 *  - Lolalytics PBI = (WR − tier_avg) × pick / (100 − ban)
 *  - log-scaled pick rate (popularity confidence, not domination)
 *  - Ban rate as positive "feared = strong" signal, capped at 30%
 *  - Sample penalty: smooth taper below ~2000 games
 *  - Final 0~100 via tanh sigmoid (center 50)
 *
 * pick-engine.js's metaScore() delegates here for single source of truth.
 */
import type { PickData } from './pick-types';

export function createTierEngine(D: PickData) {

  // ---- Constants (single source of truth) --------------------------------
  const WEIGHTS = { wr: 0.55, pbi: 0.20, pick: 0.15, ban: 0.10 };
  const SAMPLE_THRESHOLDS = { high: 5000, medium: 1000, low: 200 };
  const SAMPLE_PENALTY_HALF_K = 2000; // sqrt(N)/sqrt(N+K) decay
  const BAN_CAP_PCT = 30;             // beyond this, ban signal saturates
  const PBI_BAN_FLOOR = 50;           // (100 − min(ban, 50)) prevents perma-ban dominance
  const Z_95 = 1.96;
  const TREND_MIN_SAMPLE = 500;

  const LETTER_BANDS = [
    { min: 65, letter: 'S+', cls: 'tier-challenger' },
    { min: 58, letter: 'S',  cls: 'tier-master' },
    { min: 53, letter: 'A',  cls: 'tier-diamond' },
    { min: 48, letter: 'B',  cls: 'tier-emerald' },
    { min: 42, letter: 'C',  cls: 'tier-gold' },
    { min: 0,  letter: 'D',  cls: 'tier-silver' },
  ];

  // ---- Math helpers ------------------------------------------------------
  function clip(x, min, max) { return Math.max(min, Math.min(max, x)); }

  function wilsonLowerBound(wins, games, z) {
    if (!games || games <= 0) return 0;
    z = z || Z_95;
    const p = wins / games;
    const z2 = z * z;
    const denom = 1 + z2 / games;
    const center = p + z2 / (2 * games);
    const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * games)) / games);
    return Math.max(0, (center - margin) / denom);
  }

  function samplePenalty(n) {
    if (!n || n <= 0) return 5;
    return 5 * Math.max(0, 1 - Math.sqrt(n) / Math.sqrt(n + SAMPLE_PENALTY_HALF_K));
  }

  function pbi(wr, tierAvgWr, pickPct, banPct) {
    const wrDelta = wr - tierAvgWr;
    const banAdjusted = 100 - Math.min(banPct || 0, PBI_BAN_FLOOR);
    return wrDelta * (pickPct || 0.1) * 100 / banAdjusted;
  }

  // ---- Letter tier mapping -----------------------------------------------
  function letterTier(score) {
    for (const band of LETTER_BANDS) {
      if (score >= band.min) return band.letter;
    }
    return 'D';
  }
  function letterTierClass(letter) {
    const found = LETTER_BANDS.find((b) => b.letter === letter);
    return found ? found.cls : 'tier-iron';
  }

  // ---- Confidence label --------------------------------------------------
  function confidenceLabel(n) {
    if (n >= SAMPLE_THRESHOLDS.high) return 'high';
    if (n >= SAMPLE_THRESHOLDS.medium) return 'medium';
    if (n >= SAMPLE_THRESHOLDS.low) return 'low';
    return 'too_low';
  }

  // ---- Core: PS score ----------------------------------------------------
  function computePS(stats, tierAvgWr) {
    if (!stats || stats.n == null) return null;
    const wins = stats.wins != null ? stats.wins : (stats.wr / 100) * stats.n;

    // 1) Wilson-adjusted winrate (back to percent)
    const wrWilson = wilsonLowerBound(wins, stats.n) * 100;
    const wrComponent = (wrWilson - 50) * 5;     // ±25 typical

    // 2) PBI (lolalytics-style), clipped to ±50
    const pbiRaw = pbi(stats.wr, tierAvgWr, stats.pickrate, stats.banrate);
    const pbiComponent = clip(pbiRaw, -50, 50);

    // 3) log-scaled pick rate
    const pickComponent = Math.log10(1 + (stats.pickrate || 0)) * 12;

    // 4) ban signal (capped)
    const banComponent = Math.min((stats.banrate || 0) / BAN_CAP_PCT, 1.0) * 6;

    // 5) sample penalty (subtractive)
    const penalty = samplePenalty(stats.n);

    const raw =
        WEIGHTS.wr   * wrComponent
      + WEIGHTS.pbi  * pbiComponent
      + WEIGHTS.pick * pickComponent
      + WEIGHTS.ban  * banComponent
      - penalty;

    // tanh sigmoid → 0~100 centered on 50
    const score = 50 + 50 * Math.tanh(raw / 25);

    const letter = letterTier(score);
    return {
      score: Math.round(score * 100) / 100,
      letter,
      letterClass: letterTierClass(letter),
      breakdown: {
        wrWilson:    Math.round(wrWilson * 100) / 100,
        wrComponent: Math.round(wrComponent * 10) / 10,
        pbi:         Math.round(pbiComponent * 10) / 10,
        pick:        Math.round(pickComponent * 10) / 10,
        ban:         Math.round(banComponent * 10) / 10,
        penalty:     Math.round(penalty * 10) / 10,
        raw:         Math.round(raw * 10) / 10,
      },
      confidence: confidenceLabel(stats.n),
    };
  }

  // ---- Honey champ (SPEC F-307): high WR + low pick + low ban -----------
  function honeyChampScore(stats) {
    if (!stats || stats.n < SAMPLE_THRESHOLDS.low) return 0;
    const wrBonus       = Math.max(0, stats.wr - 50);                    // peak at WR 60+
    const lowPickBonus  = Math.max(0, 5 - (stats.pickrate || 0));        // peak at PR 0
    const lowBanBonus   = Math.max(0, 5 - (stats.banrate  || 0));        // peak at BR 0
    return wrBonus * 1.5 + lowPickBonus * 1.0 + lowBanBonus * 0.5;
  }

  // ---- Trend detection (vs previous patch snapshot) ---------------------
  function detectTrend(currentStats, prevStats) {
    if (!currentStats || !prevStats) return { label: 'stable', wrDelta: 0, prRatio: 1 };
    const wrDelta = currentStats.wr - prevStats.wr;
    const prRatio = (currentStats.pickrate || 0) / Math.max(prevStats.pickrate || 0.01, 0.01);
    let label = 'stable';
    if (currentStats.n >= TREND_MIN_SAMPLE) {
      if (wrDelta >= 1.5) label = 'rising_strong';
      else if (wrDelta >= 0.5) label = 'rising';
      else if (wrDelta <= -1.5) label = 'falling_strong';
      else if (wrDelta <= -0.5) label = 'falling';
    }
    return {
      label,
      wrDelta: Math.round(wrDelta * 100) / 100,
      prRatio: Math.round(prRatio * 100) / 100,
    };
  }
  function trendArrow(label) {
    return {
      rising_strong: '▲▲', rising: '▲',
      stable: '━',
      falling: '▼', falling_strong: '▼▼',
    }[label] || '━';
  }
  function trendClass(label) {
    if (label === 'rising_strong' || label === 'rising') return 'change-up';
    if (label === 'falling_strong' || label === 'falling') return 'change-down';
    return 'change-same';
  }

  // ---- Higher-level row builder -----------------------------------------
  function statsForLane(champKey, lane) {
    const t = D.TIER_DATA[champKey];
    return t ? t[lane] : null;
  }
  function prevStatsForLane(champKey, lane) {
    const prev = D.TIER_DATA_PREV;
    if (!prev) return null;
    const t = prev[champKey];
    return t ? t[lane] : null;
  }

  function rowFor(champKey, lane) {
    const stats = statsForLane(champKey, lane);
    if (!stats) return null;
    const prev = prevStatsForLane(champKey, lane);
    const tierAvg = D.TIER_AVG_WR[lane] || 50;
    const ps = computePS(stats, tierAvg);
    if (!ps) return null;
    const honey = honeyChampScore(stats);
    const trend = detectTrend(stats, prev);
    return {
      champion: champKey,
      lane,
      stats,
      tierScore: ps.score,
      letter: ps.letter,
      letterClass: ps.letterClass,
      breakdown: ps.breakdown,
      confidence: ps.confidence,
      honey: Math.round(honey * 100) / 100,
      trend,
      trendArrow: trendArrow(trend.label),
      trendClass: trendClass(trend.label),
    };
  }

  function tierTable(lane, options) {
    options = options || {};
    const minPickrate = options.minPickrate != null ? options.minPickrate : 0.5;
    const includeLowSample = !!options.includeLowSample;
    const rows = [];
    Object.keys(D.TIER_DATA).forEach((c) => {
      const stats = statsForLane(c, lane);
      if (!stats) return;
      if ((stats.pickrate || 0) < minPickrate) return;
      if (!includeLowSample && stats.n < SAMPLE_THRESHOLDS.low) return;
      const r = rowFor(c, lane);
      if (r) rows.push(r);
    });
    rows.sort((a, b) => b.tierScore - a.tierScore);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  }

  function fullTable(options) {
    const all = [];
    ['top', 'jungle', 'mid', 'adc', 'support'].forEach((lane) => {
      all.push(...tierTable(lane, options));
    });
    all.sort((a, b) => b.tierScore - a.tierScore);
    all.forEach((r, i) => { r.rank = i + 1; });
    return all;
  }

  return {
    wilsonLowerBound, samplePenalty, pbi,
    computePS, honeyChampScore, detectTrend,
    letterTier, letterTierClass, confidenceLabel,
    trendArrow, trendClass,
    rowFor, tierTable, fullTable,
    WEIGHTS, SAMPLE_THRESHOLDS, LETTER_BANDS,
  };
}

export type TierEngine = ReturnType<typeof createTierEngine>;
