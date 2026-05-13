/**
 * ai-score-engine.js — Per-match player AI Score (0~100).
 *
 * v2: absolute role-weighted LUT scoring (no cohort baselines).
 * Mirrors backend apps/worker/src/ai-score/engine.ts. Keep in sync.
 *
 * Inputs: PlayerStats (per match), team totals (computed once per match),
 *         game duration in seconds.
 * Outputs: { score, letter, breakdown, components }
 *
 * MVP/ACE = match-level decision (winning team max → MVP, losing team max → ACE).
 */
(function () {
  'use strict';

  const ALGO_VERSION = 'ai-score@2.0';

  // ---- Component LUTs (must match backend) --------------------------------
  // Each LUT is sorted descending by raw value; linear-interpolated between
  // adjacent rows; clamped to first/last on either end.
  const KDA_LUT  = [[6, 100], [4, 82], [3, 68], [2.2, 55], [1.5, 42], [1, 28], [0.5, 12], [0, 0]];
  const KP_LUT   = [[70, 100], [60, 85], [50, 70], [40, 55], [30, 40], [20, 25], [10, 10], [0, 0]];

  const CS_LUT_LANER   = [[9, 100], [8, 85], [7, 70], [6, 55], [5, 40], [4, 25], [3, 10], [0, 0]];
  const CS_LUT_JUNGLE  = [[6.5, 100], [5.5, 80], [4.5, 60], [3.5, 40], [2.5, 20], [0, 0]];
  const CS_LUT_SUPPORT = [[4, 100], [3, 80], [2, 60], [1, 40], [0.5, 20], [0, 0]];

  const DMG_SHARE_LUT   = [[32, 100], [28, 85], [24, 70], [20, 55], [16, 40], [12, 25], [8, 10], [0, 0]];
  const TAKEN_SHARE_LUT = [[30, 100], [25, 80], [20, 60], [15, 40], [10, 20], [0, 0]];

  const VISION_LUT_LANER   = [[1.5, 100], [1.2, 80], [1.0, 65], [0.8, 50], [0.6, 35], [0.4, 20], [0, 0]];
  const VISION_LUT_JUNGLE  = [[2.0, 100], [1.6, 80], [1.3, 65], [1.0, 50], [0.7, 35], [0, 0]];
  const VISION_LUT_SUPPORT = [[3.0, 100], [2.5, 85], [2.0, 70], [1.5, 55], [1.0, 40], [0.7, 25], [0, 0]];

  const DMG_OBJ_PM_LUT = [[800, 100], [600, 80], [400, 60], [250, 40], [150, 25], [50, 10], [0, 0]];

  // ---- Lane weights (must sum to 100) -------------------------------------
  const LANE_WEIGHTS = {
    top:     { kda: 25, kp: 10, cs: 20, dmgShare: 25, takenShare: 10, vision: 10, dmgObj: 0  },
    jungle:  { kda: 25, kp: 15, cs: 10, dmgShare: 15, takenShare: 0,  vision: 15, dmgObj: 20 },
    mid:     { kda: 25, kp: 10, cs: 25, dmgShare: 30, takenShare: 0,  vision: 10, dmgObj: 0  },
    adc:     { kda: 25, kp: 10, cs: 25, dmgShare: 30, takenShare: 0,  vision: 10, dmgObj: 0  },
    support: { kda: 25, kp: 20, cs: 5,  dmgShare: 15, takenShare: 0,  vision: 35, dmgObj: 0  },
  };

  const GRADE_BANDS = [
    { min: 88, letter: 'S+', cls: 'tier-challenger' },
    { min: 78, letter: 'S',  cls: 'tier-master' },
    { min: 66, letter: 'A',  cls: 'tier-diamond' },
    { min: 50, letter: 'B',  cls: 'tier-emerald' },
    { min: 35, letter: 'C',  cls: 'tier-gold' },
    { min: 0,  letter: 'D',  cls: 'tier-silver' },
  ];

  const COMPONENT_LABEL = {
    kda: 'KDA', kp: 'KP', cs: 'CS/분', dmgShare: '챔프딜 비중',
    takenShare: '받은 피해 비중', vision: '시야/분', dmgObj: '오브젝트 딜/분',
  };

  // ---- Helpers ------------------------------------------------------------
  function lutScore(value, lut) {
    if (!isFinite(value) || value <= lut[lut.length - 1][0]) return lut[lut.length - 1][1];
    if (value >= lut[0][0]) return lut[0][1];
    for (let i = 0; i < lut.length - 1; i++) {
      const hi = lut[i], lo = lut[i + 1];
      if (value <= hi[0] && value >= lo[0]) {
        const span = hi[0] - lo[0];
        if (span === 0) return hi[1];
        const t = (value - lo[0]) / span;
        return lo[1] + t * (hi[1] - lo[1]);
      }
    }
    return 0;
  }

  function letterGrade(score) {
    for (const b of GRADE_BANDS) if (score >= b.min) return b.letter;
    return 'D';
  }
  function letterClass(letter) {
    const b = GRADE_BANDS.find((x) => x.letter === letter);
    return b ? b.cls : 'tier-iron';
  }

  // ---- Team totals (one pass per match) ----------------------------------
  function teamTotalsFrom(players) {
    const totals = {
      dmgToChampPerMin: { blue: 0, red: 0 },
      damageTakenPerMin: { blue: 0, red: 0 },
    };
    for (const p of players) {
      totals.dmgToChampPerMin[p.team] += (p.dmgToChampPerMin || 0);
      totals.damageTakenPerMin[p.team] += (p.damageTakenPerMin || 0);
    }
    return totals;
  }

  // ---- Per-player score --------------------------------------------------
  function compute(p, totals, gameDurationSec) {
    if (!p || !p.lane) return null;
    const lane = p.lane;
    const w = LANE_WEIGHTS[lane] || LANE_WEIGHTS.mid;
    const minutes = Math.max(1, gameDurationSec / 60);

    const kdaRatio = (p.k + p.a) / Math.max(1, p.d);
    const csPerMin = (p.cs || 0) / minutes;
    const visionPm = (p.visionScore || 0) / minutes;
    const dmgObjPm = (p.dmgToObj || 0) / minutes;
    const teamDmg = totals.dmgToChampPerMin[p.team] || 0;
    const teamTaken = totals.damageTakenPerMin[p.team] || 0;
    const dmgShare = teamDmg > 0 ? ((p.dmgToChampPerMin || 0) / teamDmg) * 100 : 0;
    const takenShare = teamTaken > 0 ? ((p.damageTakenPerMin || 0) / teamTaken) * 100 : 0;

    const csLut = lane === 'jungle' ? CS_LUT_JUNGLE
                : lane === 'support' ? CS_LUT_SUPPORT
                : CS_LUT_LANER;
    const visionLut = lane === 'jungle' ? VISION_LUT_JUNGLE
                    : lane === 'support' ? VISION_LUT_SUPPORT
                    : VISION_LUT_LANER;

    const componentScores = {
      kda:        lutScore(kdaRatio, KDA_LUT),
      kp:         lutScore(p.kp || 0, KP_LUT),
      cs:         lutScore(csPerMin, csLut),
      dmgShare:   lutScore(dmgShare, DMG_SHARE_LUT),
      takenShare: lutScore(takenShare, TAKEN_SHARE_LUT),
      vision:     lutScore(visionPm, visionLut),
      dmgObj:     lutScore(dmgObjPm, DMG_OBJ_PM_LUT),
    };

    let score = 0;
    Object.keys(componentScores).forEach((k) => {
      score += componentScores[k] * (w[k] || 0) / 100;
    });

    const letter = letterGrade(score);
    const breakdown = Object.keys(componentScores).map((k) => ({
      key: k,
      label: COMPONENT_LABEL[k] || k,
      weight: w[k] || 0,
      score: Math.round(componentScores[k] * 10) / 10,
      contribution: Math.round((componentScores[k] * (w[k] || 0) / 100) * 10) / 10,
    })).filter((b) => b.weight > 0);

    return {
      score: Math.round(score * 10) / 10,
      letter,
      letterClass: letterClass(letter),
      algoVersion: ALGO_VERSION,
      breakdown,
    };
  }

  // ---- MVP / ACE detection (match-level) ---------------------------------
  function withMvpAce(scoredPlayers) {
    const blue = scoredPlayers.filter((p) => p.team === 'blue');
    const red  = scoredPlayers.filter((p) => p.team === 'red');
    const blueWin = blue.length && blue[0].win;
    const winners = blueWin ? blue : red;
    const losers  = blueWin ? red  : blue;
    if (winners.length) {
      const mvp = winners.reduce((a, b) => (a.score >= b.score ? a : b));
      mvp.label = 'MVP';
    }
    if (losers.length) {
      const ace = losers.reduce((a, b) => (a.score >= b.score ? a : b));
      ace.label = 'ACE';
    }
    return scoredPlayers;
  }

  // ---- Compute all 10 players for one match ------------------------------
  function computeMatch(matchKeyOrData) {
    const m = (typeof matchKeyOrData === 'string')
      ? (window.AIScoreData && window.AIScoreData.MATCHES && window.AIScoreData.MATCHES[matchKeyOrData])
      : matchKeyOrData;
    if (!m || !m.players) return null;

    const totals = teamTotalsFrom(m.players);
    const scored = m.players.map((p) => {
      const r = compute(p, totals, m.gameLength || 1800);
      return {
        slot: p.slot, team: p.team, champion: p.champion, lane: p.lane,
        summonerName: p.summonerName, isSelf: !!p.isSelf, win: !!p.win,
        score: r ? r.score : 50,
        letter: r ? r.letter : 'B',
        letterClass: r ? r.letterClass : 'tier-emerald',
        breakdown: r ? r.breakdown : [],
      };
    });

    return {
      matchId: typeof matchKeyOrData === 'string' ? matchKeyOrData : (m.matchId || null),
      gameLength: m.gameLength,
      bluewin: m.bluewin,
      players: withMvpAce(scored),
    };
  }

  // ---- Public API --------------------------------------------------------
  window.AIScoreEngine = {
    compute,
    computeMatch,
    teamTotalsFrom,
    letterGrade,
    letterClass,
    LANE_WEIGHTS,
    GRADE_BANDS,
    COMPONENT_LABEL,
    ALGO_VERSION,
  };
})();
