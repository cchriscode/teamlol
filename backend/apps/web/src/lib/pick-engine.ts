// @ts-nocheck
/**
 * pick-engine.ts — Pick recommendation algorithm (Next.js port).
 *
 * Wrapped as a factory: createPickEngine(D) returns the engine bound to a
 * specific PickData snapshot. Page loads PickData from
 * /api/pick-recommend/data once per (patch, bracket) and passes it in.
 *
 * Original v3 algorithm spec: docs/pick-recommend-spec.md §5.
 *
 * @ts-nocheck applied because the original is 1100+ lines of dynamically-typed
 * JS; types added incrementally in follow-up.
 */

import type { PickData, DraftState, RecommendResult } from './pick-types';

export function createPickEngine(D: PickData) {

  // ---- Confidence factor: sqrt(N)/sqrt(N+200) -----------------------------
  function confidence(n) {
    if (!n || n <= 0) return 0;
    return Math.sqrt(n) / Math.sqrt(n + 200);
  }

  // ---- Scenario classifier (spec §5.3) ------------------------------------
  // Resolve "my slot" for scoring purposes. Priority:
  //   1) Explicit ★ slot that also has a lane (full UX)
  //   2) First empty my-team slot in pick order with a lane set
  //      (so users can get recs by just setting a lane, no ★ needed)
  //   3) Explicit ★ slot even without lane (preserves legacy behavior)
  function mySlot(state) {
    const starredWithLane = state.myTeam.find((s) => s.isMine && s.lane);
    if (starredWithLane) return starredWithLane;
    const nextLaned = state.myTeam.find((s) => !s.champion && s.lane);
    if (nextLaned) return nextLaned;
    return state.myTeam.find((s) => s.isMine) || null;
  }

  function pickScenario(state) {
    const phase = state.pickPhaseGlobal;
    const me = mySlot(state);
    const myLane = me && me.lane;
    const sameLaneEnemyPicked = state.enemyTeam.some(
      (s) => s.status === 'confirmed' && s.lane === myLane && s.champion
    );
    const allyIntents = state.myTeam.filter(
      (s) => s.status === 'intent' && !s.isMine && s.champion
    ).length;

    if (phase <= 1) return allyIntents > 0 ? 'first_with_intent' : 'first_blind';
    if (phase >= 8 && sameLaneEnemyPicked) return 'last_counter_clear';
    if (phase >= 8) return 'last_general';
    return 'middle';
  }

  // Weights per scenario. D = bot-duo bonus (active only when myLane is bot).
  // Confidence factor for predicted-counter: 0.5 (vs 1.0 for confirmed picks).
  const WEIGHTS = {
    first_blind:        { M: 50, C: 0,  S: 5,  B: 25, R: 15, I: 5,  D: 0  },
    first_with_intent:  { M: 40, C: 0,  S: 15, B: 25, R: 10, I: 15, D: 0  },
    middle:             { M: 30, C: 25, S: 18, B: 12, R: 5,  I: 5,  D: 5  },
    last_general:       { M: 18, C: 40, S: 17, B: 13, R: 0,  I: 5,  D: 7  },
    last_counter_clear: { M: 13, C: 50, S: 12, B: 12, R: 0,  I: 5,  D: 8  },
  };
  // Bot-lane override: when myLane is adc/support, use these instead.
  const WEIGHTS_BOT = {
    first_blind:        { M: 45, C: 0,  S: 5,  B: 20, R: 15, I: 5,  D: 10 },
    first_with_intent:  { M: 35, C: 0,  S: 10, B: 20, R: 5,  I: 10, D: 20 },
    middle:             { M: 25, C: 15, S: 15, B: 10, R: 5,  I: 5,  D: 25 },
    last_general:       { M: 15, C: 25, S: 15, B: 10, R: 0,  I: 5,  D: 30 },
    last_counter_clear: { M: 10, C: 30, S: 10, B: 10, R: 0,  I: 5,  D: 35 },
  };
  const PREDICTED_COUNTER_DISCOUNT = 0.5;
  const PREDICTION_TOP_K = 5;
  const PREDICTION_TEMP = 2.0;

  function pickWeights(state) {
    const me = mySlot(state);
    const myLane = me && me.lane;
    const isBot = myLane === 'adc' || myLane === 'support';
    const sc = pickScenario(state);
    return (isBot ? WEIGHTS_BOT : WEIGHTS)[sc];
  }

  // ---- Score components ---------------------------------------------------

  // Delegate to TierEngine for single source of truth (spec docs/tier-spec.md).
  // Returns a normalized contribution (~ -50 to +50) so the existing weight
  // arithmetic in recommend() keeps its scale.
  function metaScore(c, lane) {
    if (!lane) return 0;
    const tier = D.TIER_DATA[c];
    if (!tier || !tier[lane]) return 0;
    const stats = tier[lane];
    if (stats.tierScore != null) {
      // Centered-±50 mapping: row's 0~100 score maps linearly into the
      // engine's ±50 meta contribution.
      return (stats.tierScore - 50) * 1.0;
    }
    const avgWr = (D.TIER_AVG_WR && D.TIER_AVG_WR[lane]) || 50;
    const wrDelta = (stats.wr - avgWr) * 100;
    const conf = confidence(stats.n);
    const pickBonus = Math.log10(Math.max(stats.pickrate, 0.5) + 1) * 8;
    const banBonus = stats.banrate > 10 ? 5 : stats.banrate > 5 ? 2 : 0;
    return wrDelta * conf * 0.6 + pickBonus + banBonus;
  }

  // Counter score considers BOTH confirmed enemy picks (1.0 weight) and
  // predicted picks for empty enemy slots (PREDICTED_COUNTER_DISCOUNT weight).
  // Tracks the SAME-LANE direct laner result as the primary signal (can be
  // negative when our pick gets countered) and adds cross-lane influences as
  // a smaller side-signal. Previously the score floored at 0 so "I'd lose
  // lane to this enemy" never showed up.
  // `predictions[idx]` is null or [{c, prob}, ...] for enemyTeam[idx].
  function counterScore(c, myLane, enemyTeam, predictions) {
    if (!myLane) return 0;

    function applyAgainst(enemyChamp, enemyLane, conf, weight) {
      const sameLane = enemyLane === myLane;
      const laneWeight = sameLane ? 1.0 : 0.2;
      const matchups = (D.MATCHUPS[myLane] && D.MATCHUPS[myLane][c]) || {};
      const m = matchups[enemyChamp];
      if (!m) return 0;
      const baseWr = (D.TIER_DATA[c] && D.TIER_DATA[c][myLane] && D.TIER_DATA[c][myLane].wr) || 50;
      const delta = (m.wr - baseWr) * 100;
      return delta * confidence(m.n) * laneWeight * conf * weight;
    }

    // The same-lane direct laner dominates; everyone else only nudges.
    let laneResult = 0;        // signed (positive when we counter them)
    let crossSum = 0;          // signed sum of cross-lane influences

    enemyTeam.forEach((slot, idx) => {
      if (slot.champion) {
        const score = applyAgainst(slot.champion, slot.lane, 1.0, 1.0);
        if (slot.lane === myLane) laneResult = score;
        else crossSum += score;
      } else if (predictions && predictions[idx] && predictions[idx].length) {
        let expected = 0;
        predictions[idx].forEach((p) => {
          expected += applyAgainst(p.c, p.lane, 1.0, p.prob);
        });
        const scaled = expected * PREDICTED_COUNTER_DISCOUNT;
        // Use top-1 prediction's lane to decide same-vs-cross bucket.
        const predLane = predictions[idx][0]?.lane;
        if (predLane === myLane) {
          // Don't overwrite a confirmed same-lane signal; only fill in when
          // we have no direct laner yet.
          if (laneResult === 0) laneResult = scaled;
        } else {
          crossSum += scaled;
        }
      }
    });

    const best = laneResult + crossSum;
    return best;
  }

  function synergyScore(c, allies) {
    let total = 0;
    allies.forEach((slot) => {
      if (!slot.champion || slot.isMine) return;
      const intentWeight = slot.status === 'confirmed' ? 1.0 : 0.5;
      const syn = D.SYNERGIES[c] && D.SYNERGIES[c][slot.champion];
      if (!syn) return;
      const aMeta = D.TIER_DATA[c];
      const bMeta = D.TIER_DATA[slot.champion];
      const aBase = aMeta ? avgWrAcrossLanes(aMeta) : 50;
      const bBase = bMeta ? avgWrAcrossLanes(bMeta) : 50;
      const baseline = (aBase + bBase) / 2;
      const delta = (syn.wr - baseline) * 100;
      total += delta * confidence(syn.n) * intentWeight;
    });
    return total;
  }

  function avgWrAcrossLanes(tierEntry) {
    const lanes = Object.values(tierEntry);
    if (!lanes.length) return 50;
    return lanes.reduce((a, l) => a + l.wr, 0) / lanes.length;
  }

  function balanceScore(c, composition) {
    const meta = D.CHAMPIONS[c];
    if (!meta) return 0;
    let score = 0;
    composition.gaps.forEach((gap) => {
      const sev = gap.severity === 'high' ? 20 : gap.severity === 'medium' ? 10 : 3;
      const fit = fitStrength(meta, gap.type);
      score += sev * fit;
    });
    return score;
  }

  function fitStrength(meta, gapType) {
    switch (gapType) {
      case 'ap':
        // Continuous AP contribution from real builds (Katarina ≈ 0.83, Yasuo
        // 0). Falls back to the binary tag if damageRatio missing.
        return meta.damageRatio?.ap != null
          ? meta.damageRatio.ap
          : (meta.damageType === 'AP' ? 1.0 : meta.damageType === 'Mixed' ? 0.5 : 0);
      case 'ad':
        return meta.damageRatio?.ad != null
          ? meta.damageRatio.ad
          : (meta.damageType === 'AD' ? 1.0 : meta.damageType === 'Mixed' ? 0.5 : 0);
      case 'tank':
        return meta.role.includes('Tank') ? 1.0 : meta.role.includes('Bruiser') ? 0.6 : 0;
      case 'cc':
        return meta.ccLevel >= 2 ? 1.0 : meta.ccLevel === 1 ? 0.4 : 0;
      case 'engage':
        return meta.engageType === 'hard' ? 1.0 : meta.engageType === 'soft' ? 0.5 : 0;
      case 'waveClear':
        return meta.waveClear >= 2 ? 1.0 : meta.waveClear === 1 ? 0.3 : 0;
      case 'scaling':
        return meta.scaling === 'late' ? 1.0 : meta.scaling === 'mid' ? 0.5 : 0;
      default:
        return 0;
    }
  }

  function riskScore(c, myLane, scenario) {
    if (scenario !== 'first_blind' && scenario !== 'first_with_intent') return 0;
    const matchups = (D.MATCHUPS[myLane] && D.MATCHUPS[myLane][c]) || {};
    const wrs = Object.values(matchups).map((m) => m.wr);
    if (!wrs.length) return 0;
    const mean = wrs.reduce((a, b) => a + b, 0) / wrs.length;
    const variance = wrs.reduce((a, b) => a + (b - mean) ** 2, 0) / wrs.length;
    const worst = Math.min(...wrs);
    const blindBonus = D.isBlindSafe(c) ? -10 : 0; // negative = less risk
    return 0.3 * variance + 2 * Math.max(0, 50 - worst) + blindBonus;
  }

  function intentScore(c, allies) {
    const meta = D.CHAMPIONS[c];
    if (!meta) return 0;
    let total = 0;
    allies.forEach((slot) => {
      if (slot.status !== 'intent' || !slot.champion || slot.isMine) return;
      const allyMeta = D.CHAMPIONS[slot.champion];
      if (!allyMeta) return;
      const overlap = (meta.archetypeAffinity || []).filter((a) =>
        (allyMeta.archetypeAffinity || []).includes(a)
      ).length;
      total += overlap * 5;
    });
    return total;
  }

  // ---- D_duo: bot-lane duo synergy + 2v2 matchup (spec §16) ---------------
  // Active only when myLane is 'adc' or 'support'.
  // Decomposes 2v2 into: synergy(myDuo) + matchup(adc-vs-adc) + matchup(sup-vs-sup)
  // Plus prediction-aware "expected enemy duo" when one bot enemy is missing.
  function duoScore(c, state, predictions) {
    const me = mySlot(state);
    const myLane = me && me.lane;
    if (myLane !== 'adc' && myLane !== 'support') return 0;

    // Find our bot partner (intent or confirmed) — opposite role
    const partnerLane = myLane === 'adc' ? 'support' : 'adc';
    const partnerSlot = state.myTeam.find(
      (s) => s.lane === partnerLane && s.champion && !s.isMine
    );
    const partnerWeight = partnerSlot
      ? (partnerSlot.status === 'confirmed' ? 1.0 : partnerSlot.status === 'intent' ? 0.5 : 0)
      : 0;

    // Find enemy bot duo (confirmed or predicted)
    let total = 0;

    // 1. Duo synergy with our partner
    if (partnerSlot && partnerWeight > 0) {
      const adcKey = myLane === 'adc' ? c : partnerSlot.champion;
      const supKey = myLane === 'support' ? c : partnerSlot.champion;
      const syn = D.botDuoSynergy(adcKey, supKey);
      if (syn) {
        total += syn.delta * partnerWeight * 6;
      }
    }

    // 2. 2v2 matchup decomposition: same-role matchup advantage
    const enemyAdc = findEnemyBot(state, 'adc', predictions);
    const enemySup = findEnemyBot(state, 'support', predictions);

    if (myLane === 'adc' && enemyAdc) {
      total += matchupDelta(c, 'adc', enemyAdc.champ) * enemyAdc.weight;
    }
    if (myLane === 'support' && enemySup) {
      total += matchupDelta(c, 'support', enemySup.champ) * enemySup.weight;
    }

    // 3. Cross-lane matchup (small weight: my role vs opposite enemy role)
    if (myLane === 'adc' && enemySup) {
      total += matchupDelta(c, 'adc', enemySup.champ) * enemySup.weight * 0.3;
    }
    if (myLane === 'support' && enemyAdc) {
      total += matchupDelta(c, 'support', enemyAdc.champ) * enemyAdc.weight * 0.3;
    }

    // 4. Enemy duo synergy advantage (negative if their duo is strong)
    if (enemyAdc && enemySup) {
      const enemySyn = D.botDuoSynergy(enemyAdc.champ, enemySup.champ);
      if (enemySyn) {
        total -= enemySyn.delta * Math.min(enemyAdc.weight, enemySup.weight) * 4;
      }
    }

    return total;
  }

  function findEnemyBot(state, role, predictions) {
    const idx = state.enemyTeam.findIndex((s) => s.lane === role && s.champion);
    if (idx >= 0) {
      return { champ: state.enemyTeam[idx].champion, weight: 1.0, predicted: false };
    }
    if (!predictions) return null;
    const predIdx = state.enemyTeam.findIndex(
      (s, i) => s.lane === role && !s.champion && predictions[i] && predictions[i].length
    );
    if (predIdx >= 0) {
      const top = predictions[predIdx][0];
      return { champ: top.c, weight: top.prob * PREDICTED_COUNTER_DISCOUNT, predicted: true };
    }
    return null;
  }

  function matchupDelta(c, lane, enemy) {
    const matchups = (D.MATCHUPS[lane] && D.MATCHUPS[lane][c]) || {};
    const m = matchups[enemy];
    if (!m) return 0;
    const baseWr = (D.TIER_DATA[c] && D.TIER_DATA[c][lane] && D.TIER_DATA[c][lane].wr) || 50;
    return (m.wr - baseWr) * confidence(m.n) * 4;
  }

  // ---- Pick prediction (spec §17) ----------------------------------------
  // For every empty slot on either team, predict top-K candidates with prob.
  // Returns: { side: { idx: [{c, lane, prob, scoreRaw}] | null } }
  function predictAllMissingPicks(state) {
    const out = { my: {}, enemy: {} };
    ['my', 'enemy'].forEach((side) => {
      const team = side === 'my' ? state.myTeam : state.enemyTeam;
      team.forEach((slot, idx) => {
        if (slot.champion) { out[side][idx] = null; return; }
        // Use the new probabilistic predictor (Stage 1) — keeps top 5 for display.
        const dist = predictEnemyDistribution(state, side, idx);
        out[side][idx] = dist.slice(0, 5);
      });
    });
    return out;
  }

  function predictMissingPick(state, side, idx, team, otherTeam) {
    const slot = team[idx];
    // Resolve lane: explicit > inferred from team's missing lanes
    let lane = slot.lane;
    if (!lane) {
      const ALL_LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
      const filled = team.filter((s, i) => i !== idx && s.lane).map((s) => s.lane);
      const missing = ALL_LANES.filter((l) => !filled.includes(l));
      if (missing.length === 1) lane = missing[0];
      // If multiple lanes missing, lane stays null and we filter by champion lanes only
    }

    const bans = new Set([...state.myBans, ...state.enemyBans]);
    const taken = new Set(
      [...state.myTeam, ...state.enemyTeam]
        .filter((s) => s.champion).map((s) => s.champion)
    );

    const champs = D.listChampions().filter((c) => {
      if (bans.has(c) || taken.has(c)) return false;
      const meta = D.CHAMPIONS[c];
      if (!meta) return false;
      if (lane && !meta.lanes.includes(lane)) return false;
      return true;
    });
    if (!champs.length) return null;

    // Score each candidate from THAT TEAM's perspective:
    // - lane meta (tier strength)
    // - synergy with own confirmed picks
    // - copick prior (if any anchor on own team)
    // - light counter-aware against opposing confirmed picks
    const ownPicks = team.filter((s) => s.champion);
    const oppPicks = otherTeam.filter((s) => s.champion);

    const scored = champs.map((c) => {
      const inferredLane = lane || inferLikelyLane(c);
      const m = inferredLane ? metaScore(c, inferredLane) : 0;
      let s = 0;
      ownPicks.forEach((p) => {
        const syn = D.SYNERGIES[c] && D.SYNERGIES[c][p.champion];
        if (syn) s += (syn.wr - 50) * 3;
      });
      let copickBonus = 0;
      ownPicks.forEach((p) => {
        if (!inferredLane) return;
        const cp = D.copickProb(p.champion, inferredLane, c);
        if (cp != null) copickBonus += cp * 30;
      });
      let lanePrior = 0;
      if (inferredLane) {
        const prior = D.laneMetaPrior(c, inferredLane);
        lanePrior = prior * 20;
      }
      // weak counter avoidance
      let counter = 0;
      oppPicks.forEach((p) => {
        const matchups = (D.MATCHUPS[inferredLane] && D.MATCHUPS[inferredLane][c]) || {};
        const mu = matchups[p.champion];
        if (mu) counter += (mu.wr - 50) * 0.5;
      });
      const raw = 0.5 * m + 0.2 * s + 0.2 * copickBonus + 0.2 * lanePrior + 0.1 * counter;
      return { c, lane: inferredLane, scoreRaw: raw };
    });

    // Softmax to probabilities
    const max = Math.max(...scored.map((x) => x.scoreRaw));
    const exps = scored.map((x) => ({
      c: x.c, lane: x.lane,
      e: Math.exp((x.scoreRaw - max) / PREDICTION_TEMP),
    }));
    const sum = exps.reduce((a, b) => a + b.e, 0);
    if (sum <= 0) return null;
    return exps
      .map((x) => ({ c: x.c, lane: x.lane, prob: x.e / sum }))
      .sort((a, b) => b.prob - a.prob)
      .slice(0, PREDICTION_TOP_K);
  }

  function inferLikelyLane(c) {
    const meta = D.CHAMPIONS[c];
    if (!meta || !meta.lanes || !meta.lanes.length) return null;
    // Among possible lanes, pick the one with highest pickrate.
    if (D.TIER_DATA && D.TIER_DATA[c]) {
      let bestLane = meta.lanes[0], bestPr = -1;
      for (const ln of meta.lanes) {
        const pr = (D.TIER_DATA[c][ln] && D.TIER_DATA[c][ln].pickrate) || 0;
        if (pr > bestPr) { bestPr = pr; bestLane = ln; }
      }
      return bestLane;
    }
    return meta.lanes[0];
  }

  // ---- Stage 1: Enemy pick distribution per slot -------------------------
  // Returns probability mass over likely champions for a given slot.
  // Uses: lane pickrate prior + copick with own existing picks + counter to
  // visible opposing picks + light synergy preference.
  //
  // This replaces / augments predictMissingPick for prediction-quality output;
  // softmax temperature is configured so dominant champ doesn't hit 100%.
  const EV_PREDICTION_TEMP = 10;
  function predictEnemyDistribution(state, side, idx) {
    const team = side === 'my' ? state.myTeam : state.enemyTeam;
    const opposing = side === 'my' ? state.enemyTeam : state.myTeam;
    const slot = team[idx];
    if (slot.champion) return [{ c: slot.champion, lane: slot.lane, prob: 1.0 }];

    // Resolve target lane
    let lane = slot.lane;
    if (!lane) {
      const ALL_LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
      const filled = team.filter((s, i) => i !== idx && s.lane).map((s) => s.lane);
      const missing = ALL_LANES.filter((l) => !filled.includes(l));
      if (missing.length === 1) lane = missing[0];
    }

    const bans = new Set([...state.myBans, ...state.enemyBans]);
    const taken = new Set(
      [...state.myTeam, ...state.enemyTeam]
        .filter((s) => s.champion).map((s) => s.champion)
    );

    const candidates = D.listChampions().filter((c) => {
      if (bans.has(c) || taken.has(c)) return false;
      const meta = D.CHAMPIONS[c];
      if (!meta) return false;
      if (lane && !meta.lanes.includes(lane)) return false;
      return true;
    });
    if (!candidates.length) return [];

    const ownPicks = team.filter((s) => s.champion);
    const oppPicks = opposing.filter((s) => s.champion);

    const scored = candidates.map((c) => {
      const targetLane = lane || inferLikelyLane(c);

      // 1) Lane meta pickrate (popularity)
      const pickrate = (D.TIER_DATA[c] && D.TIER_DATA[c][targetLane])?.pickrate ?? 0.1;

      // 2) Copick: this team's existing picks tend to bring this partner
      let copickBoost = 0;
      ownPicks.forEach((p) => {
        if (!targetLane) return;
        const cp = D.copickProb(p.champion, targetLane, c);
        if (cp != null) copickBoost += cp * 80;
      });

      // 3) Synergy with own team (people tend to pick synergistic champs)
      let synergyBoost = 0;
      ownPicks.forEach((p) => {
        const syn = D.SYNERGIES[c] && D.SYNERGIES[c][p.champion];
        if (syn && syn.n >= 30) synergyBoost += (syn.wr - 50) * 0.3;
      });

      // 4) Counter-pick: c counters opposing visible picks → this team more
      // likely to pick c (especially in counter-pick scenarios)
      let counterBoost = 0;
      oppPicks.forEach((p) => {
        const matchups = D.MATCHUPS[targetLane] || {};
        const mu = matchups[c] && matchups[c][p.champion];
        if (mu && mu.n >= 30) counterBoost += (mu.wr - 50) * 0.4;
      });

      // Combined raw score — pickrate is primary signal
      const raw = pickrate * 4 + copickBoost + synergyBoost + counterBoost;
      return { c, lane: targetLane, scoreRaw: raw };
    });

    const max = Math.max(...scored.map((x) => x.scoreRaw));
    const exps = scored.map((x) => ({
      c: x.c, lane: x.lane,
      e: Math.exp((x.scoreRaw - max) / EV_PREDICTION_TEMP),
    }));
    const sum = exps.reduce((a, b) => a + b.e, 0);
    if (sum <= 0) return [];
    return exps
      .map((x) => ({ c: x.c, lane: x.lane, prob: x.e / sum }))
      .sort((a, b) => b.prob - a.prob);
  }

  // ---- Stage 2: Team composition WR estimate -----------------------------
  // Given two fully-populated 5v5 teams (each slot has {champion, lane}),
  // estimate blue team's win rate using:
  //   - per-lane 1v1 matchup data (Bayesian-smoothed for sparse pairs)
  //   - same-team synergy pair deltas
  //   - team composition balance bonuses (CC, engage, damage type mix)
  function estimateTeamWR(blueTeam, redTeam) {
    const LANES = ['top', 'jungle', 'mid', 'adc', 'support'];
    let blueAdv = 0;       // accumulated WR advantage (above 50% baseline)
    let signals = 0;

    // 1) Per-lane matchups
    for (const ln of LANES) {
      const blueSlot = blueTeam.find((s) => s && s.lane === ln);
      const redSlot = redTeam.find((s) => s && s.lane === ln);
      if (!blueSlot?.champion || !redSlot?.champion) continue;
      const mu = D.MATCHUPS[ln]
              && D.MATCHUPS[ln][blueSlot.champion]
              && D.MATCHUPS[ln][blueSlot.champion][redSlot.champion];
      if (!mu) continue;
      // Bayesian smoothing toward 50% baseline based on sample size
      const PRIOR_N = 30, PRIOR_WR = 50;
      const blended = (mu.wr * mu.n + PRIOR_WR * PRIOR_N) / (mu.n + PRIOR_N);
      blueAdv += (blended - 50);
      signals += 1;
    }

    // 2) Same-team synergies (pairs)
    for (const team of [blueTeam, redTeam]) {
      const sign = team === blueTeam ? 1 : -1;
      for (let i = 0; i < team.length; i++) {
        for (let j = i + 1; j < team.length; j++) {
          const a = team[i]?.champion;
          const b = team[j]?.champion;
          if (!a || !b) continue;
          const syn = D.SYNERGIES[a] && D.SYNERGIES[a][b];
          if (!syn || syn.n < 30) continue;
          blueAdv += sign * (syn.wr - 50) * 0.15;   // synergy weighted lighter than matchups
        }
      }
    }

    // 3) Team-comp balance (CC / engage / damage mix)
    const blueBonus = teamCompBalance(blueTeam);
    const redBonus = teamCompBalance(redTeam);
    blueAdv += (blueBonus - redBonus);

    // Convert advantage → WR, clamped to a believable range
    return Math.max(15, Math.min(85, 50 + blueAdv));
  }

  function teamCompBalance(team) {
    const champs = team.filter((s) => s?.champion).map((s) => D.CHAMPIONS[s.champion]).filter(Boolean);
    if (champs.length < 3) return 0;
    let bonus = 0;
    const totalCC = champs.reduce((sum, c) => sum + (c.ccLevel ?? 0), 0);
    if (totalCC >= 8) bonus += 2.5;
    else if (totalCC >= 5) bonus += 1;
    else if (totalCC < 3) bonus -= 2;

    const hasEngage = champs.some((c) => c.engageType === 'engage' && (c.ccLevel ?? 0) >= 2);
    if (!hasEngage) bonus -= 1.5;

    const ad = champs.filter((c) => c.damageType === 'AD').length;
    const ap = champs.filter((c) => c.damageType === 'AP').length;
    if (champs.length === 5 && (ad === 0 || ap === 0)) bonus -= 1.5;
    return bonus;
  }

  // ---- Stage 3: Expected-value pick recommendation -----------------------
  // For a candidate champion c in lane L on side S, fill all empty slots
  // (both teams) by sampling from their per-slot prediction distribution,
  // then call estimateTeamWR. Returns the expected win rate from our side,
  // averaged across N samples.
  //
  // Was single-rollout (top-1 fill). The single sample treated predictions
  // as deterministic — a candidate good only against the modal enemy laner
  // looked better than one strong across the distribution. Monte Carlo
  // approximation here is honest probabilistic EV.
  const EV_SAMPLES = 6;

  // Cheap deterministic PRNG (mulberry32) so the same draft state always
  // yields the same EV — otherwise scores would jitter on every render.
  function makeRng(seed) {
    let s = seed >>> 0;
    return function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function sampleFromDist(dist, rng) {
    let total = 0;
    for (const it of dist) total += it.prob;
    if (total <= 0) return dist[0];
    let r = rng() * total;
    for (const it of dist) { r -= it.prob; if (r <= 0) return it; }
    return dist[dist.length - 1];
  }

  function expectedValueForPick(state, side, idx, candidate, candidateLane) {
    // Apply candidate to a deep clone
    const myTeam = state.myTeam.map((s) => ({ ...s }));
    const enemyTeam = state.enemyTeam.map((s) => ({ ...s }));
    const targetTeam = side === 'my' ? myTeam : enemyTeam;
    targetTeam[idx].champion = candidate;
    targetTeam[idx].lane = candidateLane || targetTeam[idx].lane;

    const simulated = { ...state, myTeam, enemyTeam };

    // Precompute distributions for each empty slot once. We resample fills
    // below; recomputing predictions per sample would be wasteful since
    // dependencies (own picks, enemy visible picks) don't change.
    const slotDists = { my: {}, enemy: {} };
    for (const sd of ['my', 'enemy']) {
      const team = sd === 'my' ? myTeam : enemyTeam;
      team.forEach((slot, i) => {
        if (slot.champion) return;
        const dist = predictEnemyDistribution(simulated, sd, i).slice(0, 5);
        if (dist.length > 0) slotDists[sd][i] = dist;
      });
    }

    // Deterministic seed: candidate + slot + filled-slots signature. Same
    // state → same EV across renders.
    const filledSig = [...myTeam, ...enemyTeam]
      .map((s) => s.champion || '_').join('|');
    const rng = makeRng(hashStr(`${candidate}|${idx}|${side}|${filledSig}`));

    let wrSum = 0;
    for (let s = 0; s < EV_SAMPLES; s++) {
      const my = myTeam.map((x) => ({ ...x }));
      const en = enemyTeam.map((x) => ({ ...x }));
      for (const sd of ['my', 'enemy']) {
        const team = sd === 'my' ? my : en;
        team.forEach((slot, i) => {
          if (slot.champion) return;
          const dist = slotDists[sd][i];
          if (!dist) return;
          const pick = sampleFromDist(dist, rng);
          slot.champion = pick.c;
          slot.lane = pick.lane || slot.lane;
        });
      }
      wrSum += estimateTeamWR(my, en);
    }
    const wr = wrSum / EV_SAMPLES;
    return side === 'my' ? wr : (100 - wr);
  }

  // ---- Composition analysis (spec §6) ------------------------------------

  function analyzeComposition(state) {
    const slots = state.myTeam.filter(
      (s) => s.champion && (s.status === 'confirmed' || s.status === 'intent')
    );
    const weights = slots.map((s) => (s.status === 'confirmed' ? 1.0 : 0.5));
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    if (totalWeight === 0) {
      return emptyComposition();
    }

    // Accumulate weighted AP/AD using each champ's real damageRatio (from
    // item builds) instead of the old binary AD/AP/Mixed buckets, so a champ
    // like Katarina (real ~70/30) doesn't get rounded to 50/50.
    let apW = 0, adW = 0;
    let hardCc = 0;
    let tank = 0;
    let bruiser = 0;
    let waveClear = 0;
    const scaling = { early: 0, mid: 0, late: 0 };
    let bestEngage = 'none';
    const engageOrder = { none: 0, soft: 1, pick: 2, hard: 3 };
    const archetypeVotes = {};

    slots.forEach((s, i) => {
      const meta = D.CHAMPIONS[s.champion];
      if (!meta) return;
      const w = weights[i];
      const ratio = meta.damageRatio || { ap: 0.5, ad: 0.5 };
      apW += ratio.ap * w;
      adW += ratio.ad * w;
      if (meta.ccLevel >= 2) hardCc += w * meta.ccLevel;
      if (meta.role.includes('Tank')) tank += w;
      if (meta.role.includes('Bruiser')) bruiser += w;
      waveClear += meta.waveClear * w;
      scaling[meta.scaling] += w;
      if (engageOrder[meta.engageType] > engageOrder[bestEngage]) bestEngage = meta.engageType;
      (meta.archetypeAffinity || []).forEach((a) => {
        archetypeVotes[a] = (archetypeVotes[a] || 0) + w;
      });
    });

    const adShare = Math.round((adW / totalWeight) * 100);
    const apShare = Math.round((apW / totalWeight) * 100);
    const trueShare = Math.max(0, 100 - adShare - apShare);

    let archetype = 'unknown';
    let archetypeConfidence = 0;
    const sortedArche = Object.entries(archetypeVotes).sort((a, b) => b[1] - a[1]);
    if (sortedArche.length && sortedArche[0][1] >= totalWeight * 0.5) {
      archetype = sortedArche[0][0];
      archetypeConfidence = sortedArche[0][1] / totalWeight;
    }

    const gaps = computeGaps({
      adShare, apShare, hardCc, tank, bruiser,
      bestEngage, waveClear, scaling, totalWeight, archetype,
    });

    return {
      adShare, apShare, trueShare,
      hardCcCount: Math.round(hardCc),
      ccTarget: archetype === 'engage' ? 3 : 2,
      tankCount: Math.round(tank * 10) / 10,
      bruiserCount: Math.round(bruiser * 10) / 10,
      engageType: bestEngage,
      hasEngage: bestEngage !== 'none',
      waveClear: Math.round(waveClear),
      scaling: {
        early: Math.round(scaling.early),
        mid: Math.round(scaling.mid),
        late: Math.round(scaling.late),
      },
      archetype,
      archetypeConfidence: Math.round(archetypeConfidence * 100) / 100,
      gaps,
      filledSlots: slots.length,
      totalWeight: Math.round(totalWeight * 10) / 10,
    };
  }

  function emptyComposition() {
    return {
      adShare: 0, apShare: 0, trueShare: 0,
      hardCcCount: 0, ccTarget: 2,
      tankCount: 0, bruiserCount: 0,
      engageType: 'none', hasEngage: false,
      waveClear: 0,
      scaling: { early: 0, mid: 0, late: 0 },
      archetype: 'unknown', archetypeConfidence: 0,
      gaps: [],
      filledSlots: 0, totalWeight: 0,
    };
  }

  function computeGaps(c) {
    const gaps = [];
    if (c.totalWeight < 1.5) return gaps; // not enough info

    if (c.apShare < 20) gaps.push({ type: 'ap', severity: 'high', message: `AP 딜 ${c.apShare}% (권장 30%+)` });
    else if (c.apShare < 30) gaps.push({ type: 'ap', severity: 'medium', message: `AP 딜 ${c.apShare}% — 더 보강 권장` });

    if (c.adShare < 20) gaps.push({ type: 'ad', severity: 'high', message: `AD 딜 ${c.adShare}% (권장 30%+)` });
    else if (c.adShare < 30) gaps.push({ type: 'ad', severity: 'medium', message: `AD 딜 ${c.adShare}% — 더 보강 권장` });

    if (c.tank + c.bruiser < 0.5) gaps.push({ type: 'tank', severity: 'high', message: '탱커/브루저 0명 — 프론트라인 필요' });
    else if (c.tank + c.bruiser < 1.5) gaps.push({ type: 'tank', severity: 'medium', message: '탱커 부족 — 1~2명 권장' });

    const ccTarget = c.archetype === 'engage' ? 3 : 2;
    if (c.hardCc < ccTarget) {
      const sev = c.hardCc < ccTarget - 1 ? 'high' : 'medium';
      gaps.push({ type: 'cc', severity: sev, message: `하드 CC ${c.hardCc}건 (권장 ${ccTarget}+)` });
    }

    if (c.bestEngage === 'none' && c.archetype !== 'protect' && c.archetype !== 'poke') {
      gaps.push({ type: 'engage', severity: 'medium', message: '이니시 도구 없음' });
    }

    if (c.waveClear < 4 && c.totalWeight >= 3) {
      gaps.push({ type: 'waveClear', severity: 'low', message: `웨이브 클리어 약함 (합산 ${c.waveClear})` });
    }

    if (c.scaling.late === 0 && c.scaling.early >= 2) {
      gaps.push({ type: 'scaling', severity: 'medium', message: '후반 스케일링 0명' });
    }

    return gaps;
  }

  // ---- Reason text + tags (spec §7.3) -------------------------------------

  function generateReasons(c, breakdown, ctx) {
    const reasons = [];

    if (breakdown.C > 15 && ctx.counterTarget) {
      const enemy = ctx.counterTarget;
      const enemyName = D.nameKr(enemy);
      const delta = ctx.counterDelta.toFixed(1);
      reasons.push({
        weight: breakdown.C,
        natural: `${enemyName}을 라인전에서 카운터 (+${delta}%p)`,
        tag: `#카운터-${enemyName}`,
      });
    }

    ctx.composition.gaps.forEach((gap) => {
      const meta = D.CHAMPIONS[c];
      const fit = fitStrength(meta, gap.type);
      if (fit < 0.5) return;
      const tagMap = {
        ap: '#AP보완', ad: '#AD보완', tank: '#탱커보완',
        cc: '#CC추가', engage: '#이니시추가',
        waveClear: '#웨클추가', scaling: '#후반스케일',
      };
      const naturalMap = {
        ap: `우리팀 부족한 AP 보완 (현재 ${ctx.composition.apShare}%)`,
        ad: `우리팀 부족한 AD 보완 (현재 ${ctx.composition.adShare}%)`,
        tank: '프론트라인 보완',
        cc: `하드 CC 추가 (${ctx.composition.hardCcCount}→${ctx.composition.hardCcCount + 1})`,
        engage: '이니시 도구 추가',
        waveClear: '웨이브 클리어 보완',
        scaling: '후반 스케일링 추가',
      };
      reasons.push({
        weight: gap.severity === 'high' ? 18 : 10,
        natural: naturalMap[gap.type],
        tag: tagMap[gap.type],
      });
    });

    if (breakdown.M > 20) {
      const tier = D.TIER_DATA[c] && D.TIER_DATA[c][ctx.myLane];
      if (tier) {
        const scorePart = tier.tierScore != null ? `점수 ${tier.tierScore.toFixed(1)}, ` : '';
        reasons.push({
          weight: breakdown.M * 0.5,
          natural: `패치 메타 강자 (${scorePart}WR ${tier.wr.toFixed(1)}%)`,
          tag: '#메타강자',
        });
      }
    }

    if (ctx.scenario === 'first_blind' && breakdown.R < -3) {
      reasons.push({
        weight: 8,
        natural: '선픽 안전 (변동 작음)',
        tag: '#선픽안전',
      });
    }

    if (ctx.composition.archetype !== 'unknown') {
      const meta = D.CHAMPIONS[c];
      if (meta && (meta.archetypeAffinity || []).includes(ctx.composition.archetype)) {
        const arcKr = archetypeKr(ctx.composition.archetype);
        reasons.push({
          weight: 7,
          natural: `${arcKr} 컴포 강화`,
          tag: `#${arcKr}`,
        });
      }
    }

    if (breakdown.S > 10) {
      reasons.push({
        weight: breakdown.S * 0.5,
        natural: '아군 픽과 시너지',
        tag: '#시너지',
      });
    }

    // Bot duo reasons (active when D > 0)
    if (breakdown.D > 8 && ctx.botPartner && ctx.botPartner.champion) {
      const partnerName = D.nameKr(ctx.botPartner.champion);
      const adcKey = ctx.myLane === 'adc' ? c : ctx.botPartner.champion;
      const supKey = ctx.myLane === 'support' ? c : ctx.botPartner.champion;
      const syn = D.botDuoSynergy(adcKey, supKey);
      if (syn && syn.delta > 1) {
        reasons.push({
          weight: 14,
          natural: `${partnerName}와 봇 듀오 시너지 +${syn.delta.toFixed(1)}%p`,
          tag: `#듀오-${partnerName}`,
        });
      }
    }
    if (breakdown.D > 6 && ctx.predictedEnemyBot) {
      const eb = ctx.predictedEnemyBot;
      if (eb.adc && eb.adc.predicted && ctx.myLane) {
        reasons.push({
          weight: 10,
          natural: `예상 적 원딜 ${D.nameKr(eb.adc.champ)} 카운터 가능`,
          tag: '#예측카운터',
        });
      }
    }

    if (ctx.enemyBannedOurCounter && ctx.enemyBannedOurCounter.length) {
      const counterName = D.nameKr(ctx.enemyBannedOurCounter[0]);
      reasons.push({
        weight: 5,
        natural: `적이 ${counterName} 밴 → 안전`,
        tag: '#밴시그널',
      });
    }

    // ---- EV-based reasons (Stage 3: expected value) ---------------------
    // Surface the *why* of the new expectiminimax signal so users see the new
    // logic isn't a black box.
    if (breakdown.E != null) {
      const ev = breakdown.E;
      if (ev >= 54) {
        reasons.push({
          weight: 25,
          natural: `예상 적 조합 대비 기댓값 ${ev.toFixed(1)}% (유리)`,
          tag: '#기댓값상위',
        });
      } else if (ev >= 51) {
        reasons.push({
          weight: 12,
          natural: `예상 적 조합 대비 기댓값 ${ev.toFixed(1)}%`,
          tag: '#기댓값양호',
        });
      } else if (ev < 47) {
        // Negative signal — actively flag risk
        reasons.push({
          weight: 4,
          natural: `예상 적 조합에 약함 (기댓값 ${ev.toFixed(1)}%)`,
          tag: '#예상적불리',
        });
      }
    }

    // Surface predicted enemy threats if our counter score is high
    if (ctx.predictedEnemyTop3 && ctx.predictedEnemyTop3.length && breakdown.C > 8) {
      const topThreat = ctx.predictedEnemyTop3[0];
      if (topThreat && topThreat.prob >= 0.15) {
        reasons.push({
          weight: 10,
          natural: `예상 적 ${D.nameKr(topThreat.c)} (${Math.round(topThreat.prob * 100)}%) 카운터`,
          tag: `#예측카운터-${D.nameKr(topThreat.c)}`,
        });
      }
    }

    reasons.sort((a, b) => b.weight - a.weight);
    const reasonText = reasons.length ? reasons[0].natural : '추천 점수 균형 양호';
    const reasonTags = reasons.slice(0, 3).map((r) => r.tag);
    return { reasonText, reasonTags };
  }

  function archetypeKr(a) {
    return { engage: '엔게이지', poke: '포크', pick: '픽', protect: '프로텍트', split: '스플릿' }[a] || a;
  }

  // ---- Mastery info (spec §7.2) -------------------------------------------

  function masteryInfo(c) {
    const diff = D.effectiveDifficulty(c);
    const games = D.seasonGames(c);
    let label, msg;
    if (diff <= 3) { label = 'easy';   msg = '쉬운 챔프 · 처음 픽해도 OK'; }
    else if (diff <= 5) { label = 'medium'; msg = '기본기 있으면 OK'; }
    else if (diff <= 7) { label = 'hard';   msg = '시즌 20판+ 권장'; }
    else                { label = 'insane'; msg = '시즌 50판+ 권장'; }
    return { difficulty: label, seasonGames: games, message: msg };
  }

  // ---- Counter target detection (for reasons) -----------------------------

  function detectCounterTarget(c, myLane, enemyTeam) {
    if (!myLane) return null;
    let bestEnemy = null;
    let bestDelta = -Infinity;
    enemyTeam.forEach((slot) => {
      if (!slot.champion || slot.lane !== myLane) return;
      const matchups = (D.MATCHUPS[myLane] && D.MATCHUPS[myLane][c]) || {};
      const m = matchups[slot.champion];
      if (!m) return;
      const baseWr = (D.TIER_DATA[c] && D.TIER_DATA[c][myLane] && D.TIER_DATA[c][myLane].wr) || 50;
      const delta = m.wr - baseWr;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestEnemy = slot.champion;
      }
    });
    return bestEnemy ? { enemy: bestEnemy, delta: bestDelta } : null;
  }

  // ---- Ban suggestions (spec §9.4) ----------------------------------------

  function recommendBans(state) {
    const candidates = [];
    Object.keys(D.TIER_DATA).forEach((c) => {
      const meta = D.CHAMPIONS[c];
      if (!meta) return;
      // banScore = winrate × pickrate × sqrt(banrate), aggregated across lanes
      let totalScore = 0;
      Object.values(D.TIER_DATA[c]).forEach((stats) => {
        const score = (stats.wr / 50) * stats.pickrate * Math.sqrt(stats.banrate || 1);
        if (score > totalScore) totalScore = score;
      });
      if (state.myBans.includes(c) || state.enemyBans.includes(c)) return;
      const reason = bestBanReason(c);
      candidates.push({ champion: c, opScore: Math.round(totalScore * 10) / 10, reason });
    });
    candidates.sort((a, b) => b.opScore - a.opScore);
    return candidates.slice(0, 10);
  }

  function bestBanReason(c) {
    const lanes = D.TIER_DATA[c];
    if (!lanes) return '';
    const best = Object.entries(lanes).sort((a, b) => (b[1].tierScore ?? 0) - (a[1].tierScore ?? 0))[0];
    if (!best) return '';
    return `${laneKr(best[0])} ${best[1].wr.toFixed(1)}% · 밴 ${best[1].banrate.toFixed(1)}%`;
  }

  function laneKr(l) {
    return { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' }[l] || l;
  }

  // ---- Main entry ---------------------------------------------------------

  function recommend(state) {
    const me = mySlot(state);
    const myLane = me && me.lane;
    const scenario = pickScenario(state);
    const weights = pickWeights(state);
    const composition = analyzeComposition(state);
    const allies = state.myTeam;

    const allBans = new Set([...state.myBans, ...state.enemyBans]);
    const allyChamps = new Set(state.myTeam.filter((s) => s.champion).map((s) => s.champion));
    const enemyChamps = new Set(state.enemyTeam.filter((s) => s.champion).map((s) => s.champion));

    // Predict missing picks for both teams (used by C and D)
    const allPredictions = predictAllMissingPicks(state);
    const enemyPredArr = state.enemyTeam.map((s, i) => allPredictions.enemy[i]);

    // Detect enemy bans of our key counters (for reason text)
    const enemyBannedOurCounter = state.enemyBans.filter((c) => {
      return D.MATCHUPS[myLane] && Object.values(D.MATCHUPS[myLane] || {}).some((m) => m[c] && m[c].wr < 47);
    });

    // Locate the user's slot for EV-based scoring (Stage 3).
    // Use the same resolution as mySlot() so users get scoring even without ★.
    const mySlotIdx = me ? state.myTeam.indexOf(me) : -1;
    const enableEV = mySlotIdx >= 0;

    const candidates = [];
    Object.keys(D.CHAMPIONS).forEach((c) => {
      const meta = D.CHAMPIONS[c];
      if (!meta) return;
      if (myLane && !meta.lanes.includes(myLane)) return;
      if (allyChamps.has(c) || enemyChamps.has(c)) return;

      const M = metaScore(c, myLane);
      const C = counterScore(c, myLane, state.enemyTeam, enemyPredArr);
      const S = synergyScore(c, allies);
      const B = balanceScore(c, composition);
      const R = riskScore(c, myLane, scenario);
      const I = intentScore(c, allies);
      const Dd = duoScore(c, state, enemyPredArr);

      // Stage 3: Expected team WR if we pick c, given probabilistic fill of
      // remaining slots. Centered around 50 — values above 50 mean this pick
      // raises team WR above the toss-up baseline.
      const E = enableEV ? expectedValueForPick(state, 'my', mySlotIdx, c, myLane) : 50;

      const breakdown = { M, C, S, B, R, I, D: Dd, E };

      // EV gets strongest weight as primary signal; others contribute as
      // tie-breakers and explainable sub-factors.
      const raw =
        weights.M * M / 100 +
        weights.C * C / 100 +
        weights.S * S / 100 +
        weights.B * B / 100 -
        weights.R * R / 100 +
        weights.I * I / 100 +
        weights.D * Dd / 100 +
        (E - 50) * 1.2;     // EV component, centered

      const score = Math.max(0, Math.min(100, raw + 50));

      const counterDetect = detectCounterTarget(c, myLane, state.enemyTeam);
      // Find the predicted enemy laner facing us (same lane, opposing team)
      let predictedEnemyTop3 = null;
      if (myLane) {
        const enemyLaneSlotIdx = state.enemyTeam.findIndex((s) => !s.champion && s.lane === myLane);
        if (enemyLaneSlotIdx >= 0 && allPredictions.enemy[enemyLaneSlotIdx]) {
          predictedEnemyTop3 = allPredictions.enemy[enemyLaneSlotIdx].slice(0, 3);
        }
      }
      const ctx = {
        myLane,
        scenario,
        composition,
        counterTarget: counterDetect ? counterDetect.enemy : null,
        counterDelta: counterDetect ? counterDetect.delta : 0,
        enemyBannedOurCounter,
        botPartner: getBotPartner(state, myLane),
        predictedEnemyBot: getPredictedEnemyBot(state, enemyPredArr),
        predictedEnemyTop3,
      };
      const reasons = generateReasons(c, scaledBreakdown(breakdown, weights), ctx);

      candidates.push({
        champion: c,
        score: Math.round(score * 10) / 10,
        breakdown: scaledBreakdown(breakdown, weights),
        reasonText: reasons.reasonText,
        reasonTags: reasons.reasonTags,
        masteryInfo: masteryInfo(c),
        isBanned: allBans.has(c),
        bannedBy: state.myBans.includes(c) ? 'us' : state.enemyBans.includes(c) ? 'enemy' : null,
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 15);

    return {
      candidates: top,
      composition,
      banSuggestions: recommendBans(state),
      predictions: allPredictions,
      meta: {
        patch: D.PATCH,
        tierBracket: state.tierBracket || D.BRACKET,
        sampleStaleness: 'fresh',
        scenario,
        weights,
        computedAt: new Date().toISOString(),
      },
    };
  }

  function getBotPartner(state, myLane) {
    if (myLane !== 'adc' && myLane !== 'support') return null;
    const partnerLane = myLane === 'adc' ? 'support' : 'adc';
    return state.myTeam.find((s) => s.lane === partnerLane && s.champion && !s.isMine) || null;
  }

  function getPredictedEnemyBot(state, predictions) {
    const adc = findEnemyBot(state, 'adc', predictions);
    const sup = findEnemyBot(state, 'support', predictions);
    return { adc, sup };
  }

  function scaledBreakdown(raw, weights) {
    return {
      M: Math.round(weights.M * raw.M / 100 * 10) / 10,
      C: Math.round(weights.C * raw.C / 100 * 10) / 10,
      S: Math.round(weights.S * raw.S / 100 * 10) / 10,
      B: Math.round(weights.B * raw.B / 100 * 10) / 10,
      R: Math.round(-weights.R * raw.R / 100 * 10) / 10,
      I: Math.round(weights.I * raw.I / 100 * 10) / 10,
      D: Math.round(weights.D * raw.D / 100 * 10) / 10,
      E: raw.E != null ? Math.round(raw.E * 10) / 10 : null,
    };
  }

  return {
    recommend,
    pickScenario,
    analyzeComposition,
    predictMissingPick,
    predictAllMissingPicks,
    predictEnemyDistribution,
    estimateTeamWR,
    expectedValueForPick,
    WEIGHTS,
    WEIGHTS_BOT,
    archetypeKr,
    laneKr,
    botArchetypeKr: (a: string) => (D.BOT_DUO_ARCHETYPES && D.BOT_DUO_ARCHETYPES[a] && D.BOT_DUO_ARCHETYPES[a].label) || a,
  };
}

export type PickEngine = ReturnType<typeof createPickEngine>;
