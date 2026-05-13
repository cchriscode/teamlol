/**
 * ai-score-data.js — Per-match player stats + cohort baselines (z-score).
 *
 * In production: per-match stats from MATCH-V5 + timeline; cohort baselines
 * from a nightly aggregator (champion × lane × bracket × win/loss).
 * This file is just dummy data for the prototype.
 */
(function () {
  'use strict';

  const PATCH = '26.09';
  const BRACKET = 'diamond+';

  // ---- Match samples ----------------------------------------------------
  // Each match has 10 player stat blobs. Phase split keys:
  //   laning  (0~14m), midgame (14~25m), late (25m+).
  // Numbers are realistic-ish for a diamond+ ranked game.
  const MATCHES = {
    'KR_DEMO_001': {
      gameLength: 28 * 60 + 12,         // 28:12
      queueId: 420,                     // solo ranked
      bracket: BRACKET,
      bluewin: true,
      players: [
        // Self — Azir mid carry 12/3/8 (the demo match in summoner.html)
        {
          slot: 0, team: 'blue', champion: 'Azir', lane: 'mid',
          summonerName: 'Hide on bush', isSelf: true, win: true,
          k: 12, d: 3, a: 8, kp: 74,
          cs: 232, csAt14: 118, csDiffAt14: +14,
          goldPerMin: 526, xpPerMin: 612,
          dmgToChampPerMin: 1362, dmgToObj: 4820,
          visionScore: 28, wardsPlaced: 12, wardsKilled: 4,
          damageTakenPerMin: 785, dmgMitigatedPerMin: 240,
          timeDeadPct: 4.2,
          soloKills: 3, multiKills: 2,            // 2 doubles
          worthlessDeaths: 0, freeKillsCount: 1,
          phases: {
            laning: { k: 4, d: 1, a: 2, dmgToChamp: 8200, csDiff: +14 },
            midgame:{ k: 5, d: 1, a: 3, dmgToChamp: 14820, kp: 78 },
            late:   { k: 3, d: 1, a: 3, dmgToChamp: 15400, kp: 85 },
          },
        },
        // Allies (4)
        { slot:1, team:'blue', champion:'Graves', lane:'jungle', summonerName:'Canyon', win:true,
          k:5, d:4, a:11, kp:74, cs:178, csAt14:88, csDiffAt14:+8, goldPerMin:472, xpPerMin:548,
          dmgToChampPerMin:935, dmgToObj:8420, visionScore:22, wardsPlaced:9, wardsKilled:3,
          damageTakenPerMin:980, dmgMitigatedPerMin:312, timeDeadPct:7.0, soloKills:1, multiKills:0,
          worthlessDeaths:1, freeKillsCount:0,
          phases:{ laning:{k:1,d:1,a:3,dmgToChamp:5200,csDiff:+8}, midgame:{k:2,d:1,a:5,dmgToChamp:10200,kp:70}, late:{k:2,d:2,a:3,dmgToChamp:10800,kp:80} } },
        { slot:2, team:'blue', champion:'Jax', lane:'top', summonerName:'Zeus', win:true,
          k:7, d:5, a:6, kp:55, cs:198, csAt14:96, csDiffAt14:+4, goldPerMin:478, xpPerMin:566,
          dmgToChampPerMin:1018, dmgToObj:5120, visionScore:18, wardsPlaced:11, wardsKilled:2,
          damageTakenPerMin:1240, dmgMitigatedPerMin:412, timeDeadPct:8.4, soloKills:2, multiKills:0,
          worthlessDeaths:1, freeKillsCount:0,
          phases:{ laning:{k:2,d:2,a:1,dmgToChamp:7200,csDiff:+4}, midgame:{k:3,d:2,a:2,dmgToChamp:11200,kp:50}, late:{k:2,d:1,a:3,dmgToChamp:10100,kp:60} } },
        { slot:3, team:'blue', champion:'Ezreal', lane:'adc', summonerName:'Gumayusi', win:true,
          k:9, d:2, a:7, kp:67, cs:241, csAt14:120, csDiffAt14:-2, goldPerMin:502, xpPerMin:534,
          dmgToChampPerMin:1142, dmgToObj:3820, visionScore:15, wardsPlaced:7, wardsKilled:1,
          damageTakenPerMin:592, dmgMitigatedPerMin:140, timeDeadPct:2.8, soloKills:0, multiKills:1,
          worthlessDeaths:0, freeKillsCount:2,
          phases:{ laning:{k:2,d:0,a:2,dmgToChamp:6800,csDiff:-2}, midgame:{k:4,d:1,a:2,dmgToChamp:13200,kp:62}, late:{k:3,d:1,a:3,dmgToChamp:12000,kp:75} } },
        { slot:4, team:'blue', champion:'Renata', lane:'support', summonerName:'Keria', win:true,
          k:2, d:4, a:18, kp:81, cs:32, csAt14:14, csDiffAt14:+2, goldPerMin:348, xpPerMin:412,
          dmgToChampPerMin:386, dmgToObj:480, visionScore:62, wardsPlaced:32, wardsKilled:18,
          damageTakenPerMin:540, dmgMitigatedPerMin:180, timeDeadPct:6.4, soloKills:0, multiKills:0,
          worthlessDeaths:0, freeKillsCount:0,
          phases:{ laning:{k:0,d:1,a:4,dmgToChamp:2200,csDiff:+2}, midgame:{k:1,d:2,a:8,dmgToChamp:4800,kp:84}, late:{k:1,d:1,a:6,dmgToChamp:3800,kp:78} } },
        // Enemies (5) — losers
        { slot:5, team:'red', champion:'Ahri', lane:'mid', summonerName:'Chovy', win:false,
          k:5, d:8, a:4, kp:53, cs:198, csAt14:104, csDiffAt14:-14, goldPerMin:424, xpPerMin:508,
          dmgToChampPerMin:868, dmgToObj:1820, visionScore:24, wardsPlaced:14, wardsKilled:5,
          damageTakenPerMin:920, dmgMitigatedPerMin:180, timeDeadPct:14.2, soloKills:1, multiKills:0,
          worthlessDeaths:2, freeKillsCount:0,
          phases:{ laning:{k:1,d:3,a:1,dmgToChamp:5200,csDiff:-14}, midgame:{k:2,d:3,a:1,dmgToChamp:9800,kp:55}, late:{k:2,d:2,a:2,dmgToChamp:9300,kp:50} } },
        { slot:6, team:'red', champion:'Vi', lane:'jungle', summonerName:'Peanut', win:false,
          k:4, d:7, a:8, kp:62, cs:156, csAt14:78, csDiffAt14:-10, goldPerMin:420, xpPerMin:482,
          dmgToChampPerMin:720, dmgToObj:6240, visionScore:20, wardsPlaced:8, wardsKilled:2,
          damageTakenPerMin:1180, dmgMitigatedPerMin:340, timeDeadPct:13.4, soloKills:0, multiKills:0,
          worthlessDeaths:2, freeKillsCount:1,
          phases:{ laning:{k:1,d:2,a:2,dmgToChamp:3800,csDiff:-10}, midgame:{k:2,d:3,a:3,dmgToChamp:8200,kp:60}, late:{k:1,d:2,a:3,dmgToChamp:8200,kp:65} } },
        { slot:7, team:'red', champion:'Gangplank', lane:'top', summonerName:'Kiin', win:false,
          k:6, d:4, a:5, kp:65, cs:212, csAt14:108, csDiffAt14:-4, goldPerMin:472, xpPerMin:514,
          dmgToChampPerMin:1080, dmgToObj:4180, visionScore:16, wardsPlaced:9, wardsKilled:1,
          damageTakenPerMin:980, dmgMitigatedPerMin:280, timeDeadPct:8.4, soloKills:1, multiKills:0,
          worthlessDeaths:1, freeKillsCount:0,
          phases:{ laning:{k:1,d:1,a:2,dmgToChamp:6800,csDiff:-4}, midgame:{k:3,d:2,a:2,dmgToChamp:11200,kp:60}, late:{k:2,d:1,a:1,dmgToChamp:11800,kp:72} } },
        { slot:8, team:'red', champion:'Zeri', lane:'adc', summonerName:'Peyz', win:false,
          k:4, d:6, a:5, kp:60, cs:225, csAt14:118, csDiffAt14:-2, goldPerMin:488, xpPerMin:516,
          dmgToChampPerMin:1212, dmgToObj:3920, visionScore:14, wardsPlaced:6, wardsKilled:1,
          damageTakenPerMin:680, dmgMitigatedPerMin:160, timeDeadPct:11.0, soloKills:0, multiKills:0,
          worthlessDeaths:1, freeKillsCount:1,
          phases:{ laning:{k:0,d:2,a:2,dmgToChamp:5800,csDiff:-2}, midgame:{k:2,d:2,a:1,dmgToChamp:13800,kp:55}, late:{k:2,d:2,a:2,dmgToChamp:14400,kp:65} } },
        { slot:9, team:'red', champion:'Lulu', lane:'support', summonerName:'Lehends', win:false,
          k:1, d:6, a:12, kp:65, cs:28, csAt14:12, csDiffAt14:-2, goldPerMin:332, xpPerMin:398,
          dmgToChampPerMin:312, dmgToObj:380, visionScore:54, wardsPlaced:28, wardsKilled:14,
          damageTakenPerMin:480, dmgMitigatedPerMin:140, timeDeadPct:10.4, soloKills:0, multiKills:0,
          worthlessDeaths:1, freeKillsCount:0,
          phases:{ laning:{k:0,d:2,a:2,dmgToChamp:1800,csDiff:-2}, midgame:{k:1,d:2,a:5,dmgToChamp:3800,kp:68}, late:{k:0,d:2,a:5,dmgToChamp:3200,kp:60} } },
      ],
    },
  };

  // ---- Cohort baselines (champion × lane × bracket × result) ------------
  // (mean, std) per stat per cohort. In production: nightly aggregator.
  // For prototype: only the champs in MATCHES, plus a per-lane global prior fallback.
  const COHORTS = {
    Azir: { mid: { 'diamond+': {
      win:  { kda:[5.4,2.0], dmgPm:[1180,260], goldPm:[490,55], csAt14:[112,12], csDiffAt14:[+8,12], dmgObj:[3800,1400], vision:[28,8], dmgTakenPm:[820,180], timeDead:[6.5,3.0], soloKills:[1.4,1.0], multiKills:[0.3,0.5] },
      loss: { kda:[2.4,1.4], dmgPm:[920,210],  goldPm:[420,50], csAt14:[100,12], csDiffAt14:[-6,12],  dmgObj:[2800,1100], vision:[24,8], dmgTakenPm:[920,200], timeDead:[12.0,4.0], soloKills:[0.5,0.7], multiKills:[0.1,0.3] },
    } } },
    Orianna: { mid: { 'diamond+': {
      win:  { kda:[5.0,1.9], dmgPm:[1100,240], goldPm:[480,55], csAt14:[110,12], csDiffAt14:[+6,12], dmgObj:[3600,1300], vision:[28,8], dmgTakenPm:[800,180], timeDead:[6.8,3.2], soloKills:[1.0,0.8], multiKills:[0.3,0.5] },
      loss: { kda:[2.2,1.2], dmgPm:[860,200],  goldPm:[418,50], csAt14:[98,12],  csDiffAt14:[-7,12], dmgObj:[2600,1100], vision:[24,8], dmgTakenPm:[920,200], timeDead:[11.8,4.0], soloKills:[0.4,0.6], multiKills:[0.1,0.3] },
    } } },
    Sylas: { mid: { 'diamond+': {
      win:  { kda:[4.6,1.8], dmgPm:[1080,240], goldPm:[480,55], csAt14:[104,14], csDiffAt14:[+4,14], dmgObj:[3400,1200], vision:[26,8], dmgTakenPm:[920,200], timeDead:[7.2,3.4], soloKills:[1.3,0.9], multiKills:[0.4,0.5] },
      loss: { kda:[2.0,1.2], dmgPm:[840,200],  goldPm:[412,52], csAt14:[94,14],  csDiffAt14:[-7,14], dmgObj:[2500,1000], vision:[22,8], dmgTakenPm:[1020,210], timeDead:[12.4,4.2], soloKills:[0.5,0.6], multiKills:[0.1,0.3] },
    } } },
    Ahri: { mid: { 'diamond+': {
      win:  { kda:[4.8,1.8], dmgPm:[1080,230], goldPm:[470,55], csAt14:[108,12], csDiffAt14:[+5,12], dmgObj:[3000,1100], vision:[26,8], dmgTakenPm:[820,180], timeDead:[6.8,3.2], soloKills:[1.2,0.9], multiKills:[0.3,0.5] },
      loss: { kda:[2.2,1.2], dmgPm:[860,200],  goldPm:[420,50], csAt14:[98,12],  csDiffAt14:[-6,12], dmgObj:[2400,1000], vision:[24,8], dmgTakenPm:[920,200], timeDead:[11.6,4.0], soloKills:[0.5,0.7], multiKills:[0.1,0.3] },
    } } },
    Graves:    { jungle:  { 'diamond+': { win:{ kda:[4.4,1.9],dmgPm:[920,220],goldPm:[470,50],csAt14:[88,12],csDiffAt14:[+4,12],dmgObj:[8400,2200],vision:[22,7],dmgTakenPm:[1020,220],timeDead:[7.4,3.4],soloKills:[1.1,0.9],multiKills:[0.3,0.5] }, loss:{ kda:[2.0,1.2],dmgPm:[720,200],goldPm:[420,50],csAt14:[80,12],csDiffAt14:[-3,12],dmgObj:[6800,2000],vision:[18,7],dmgTakenPm:[1140,240],timeDead:[12.5,4.0],soloKills:[0.4,0.6],multiKills:[0.1,0.3] } } } },
    Vi:        { jungle:  { 'diamond+': { win:{ kda:[4.2,1.8],dmgPm:[820,200],goldPm:[440,48],csAt14:[80,12],csDiffAt14:[+2,12],dmgObj:[7800,2000],vision:[24,7],dmgTakenPm:[1180,240],timeDead:[7.6,3.4],soloKills:[0.6,0.7],multiKills:[0.2,0.4] }, loss:{ kda:[1.9,1.2],dmgPm:[660,180],goldPm:[400,48],csAt14:[72,12],csDiffAt14:[-3,12],dmgObj:[6200,1900],vision:[20,7],dmgTakenPm:[1280,260],timeDead:[12.8,4.2],soloKills:[0.3,0.5],multiKills:[0.1,0.3] } } } },
    Jax:       { top:     { 'diamond+': { win:{ kda:[4.5,1.9],dmgPm:[1020,240],goldPm:[470,52],csAt14:[100,14],csDiffAt14:[+5,14],dmgObj:[5400,1700],vision:[18,6],dmgTakenPm:[1240,260],timeDead:[7.8,3.5],soloKills:[1.4,1.0],multiKills:[0.2,0.4] }, loss:{ kda:[2.0,1.2],dmgPm:[820,200],goldPm:[420,50],csAt14:[92,14],csDiffAt14:[-4,14],dmgObj:[4400,1600],vision:[14,6],dmgTakenPm:[1340,280],timeDead:[12.6,4.2],soloKills:[0.5,0.7],multiKills:[0.1,0.3] } } } },
    Gangplank: { top:     { 'diamond+': { win:{ kda:[4.3,1.8],dmgPm:[1100,240],goldPm:[490,52],csAt14:[114,14],csDiffAt14:[+4,14],dmgObj:[4800,1600],vision:[18,6],dmgTakenPm:[980,220],timeDead:[7.0,3.2],soloKills:[1.0,0.9],multiKills:[0.2,0.4] }, loss:{ kda:[1.9,1.1],dmgPm:[880,210],goldPm:[440,50],csAt14:[104,14],csDiffAt14:[-4,14],dmgObj:[3800,1400],vision:[14,6],dmgTakenPm:[1080,240],timeDead:[12.0,4.0],soloKills:[0.4,0.6],multiKills:[0.1,0.3] } } } },
    Ezreal:    { adc:     { 'diamond+': { win:{ kda:[4.8,1.9],dmgPm:[1180,250],goldPm:[510,55],csAt14:[120,12],csDiffAt14:[+2,12],dmgObj:[4200,1500],vision:[16,5],dmgTakenPm:[620,160],timeDead:[6.0,2.8],soloKills:[0.4,0.5],multiKills:[0.5,0.6] }, loss:{ kda:[2.1,1.2],dmgPm:[940,210],goldPm:[450,50],csAt14:[110,12],csDiffAt14:[-3,12],dmgObj:[3400,1300],vision:[14,5],dmgTakenPm:[700,180],timeDead:[11.8,4.0],soloKills:[0.2,0.4],multiKills:[0.2,0.4] } } } },
    Zeri:      { adc:     { 'diamond+': { win:{ kda:[4.6,1.9],dmgPm:[1240,260],goldPm:[510,55],csAt14:[118,12],csDiffAt14:[+2,12],dmgObj:[4400,1500],vision:[16,5],dmgTakenPm:[700,180],timeDead:[6.4,3.0],soloKills:[0.3,0.5],multiKills:[0.6,0.7] }, loss:{ kda:[2.0,1.2],dmgPm:[1000,220],goldPm:[450,50],csAt14:[108,12],csDiffAt14:[-3,12],dmgObj:[3500,1300],vision:[14,5],dmgTakenPm:[760,180],timeDead:[12.0,4.0],soloKills:[0.2,0.4],multiKills:[0.2,0.4] } } } },
    Renata:    { support: { 'diamond+': { win:{ kda:[5.5,1.9],dmgPm:[420,140],goldPm:[360,40],csAt14:[14,8],csDiffAt14:[+1,4],dmgObj:[600,300],vision:[58,12],dmgTakenPm:[580,160],timeDead:[6.8,3.2],soloKills:[0.0,0.2],multiKills:[0.0,0.2] }, loss:{ kda:[2.6,1.2],dmgPm:[340,120],goldPm:[320,40],csAt14:[12,8],csDiffAt14:[0,4],dmgObj:[450,260],vision:[50,12],dmgTakenPm:[640,180],timeDead:[12.4,4.0],soloKills:[0.0,0.2],multiKills:[0.0,0.2] } } } },
    Lulu:      { support: { 'diamond+': { win:{ kda:[5.6,1.9],dmgPm:[440,140],goldPm:[360,40],csAt14:[14,8],csDiffAt14:[+1,4],dmgObj:[580,280],vision:[56,12],dmgTakenPm:[560,160],timeDead:[6.6,3.0],soloKills:[0.0,0.2],multiKills:[0.0,0.2] }, loss:{ kda:[2.5,1.2],dmgPm:[360,120],goldPm:[320,40],csAt14:[12,8],csDiffAt14:[0,4],dmgObj:[440,260],vision:[48,12],dmgTakenPm:[620,180],timeDead:[12.2,4.0],soloKills:[0.0,0.2],multiKills:[0.0,0.2] } } } },
  };

  // ---- Lane-level global priors (fallback when champion-cohort sample low)
  const LANE_GLOBAL = {
    top:     { 'diamond+': { win:{ kda:[4.0,1.8],dmgPm:[940,230],goldPm:[460,55],csAt14:[100,16],csDiffAt14:[0,16],dmgObj:[4400,1700],vision:[18,7],dmgTakenPm:[1180,260],timeDead:[7.4,3.4],soloKills:[0.9,0.8],multiKills:[0.2,0.4] }, loss:{ kda:[1.9,1.1],dmgPm:[760,200],goldPm:[420,50],csAt14:[92,16],csDiffAt14:[0,16],dmgObj:[3600,1500],vision:[14,7],dmgTakenPm:[1280,280],timeDead:[12.4,4.2],soloKills:[0.4,0.6],multiKills:[0.1,0.3] } } },
    jungle:  { 'diamond+': { win:{ kda:[4.2,1.8],dmgPm:[820,210],goldPm:[450,50],csAt14:[80,14],csDiffAt14:[0,14],dmgObj:[8000,2200],vision:[22,7],dmgTakenPm:[1100,240],timeDead:[7.6,3.4],soloKills:[0.7,0.7],multiKills:[0.2,0.4] }, loss:{ kda:[1.9,1.1],dmgPm:[680,190],goldPm:[400,48],csAt14:[72,14],csDiffAt14:[0,14],dmgObj:[6400,2000],vision:[18,7],dmgTakenPm:[1220,260],timeDead:[12.6,4.2],soloKills:[0.3,0.5],multiKills:[0.1,0.3] } } },
    mid:     { 'diamond+': { win:{ kda:[4.8,1.9],dmgPm:[1080,250],goldPm:[470,55],csAt14:[106,14],csDiffAt14:[0,14],dmgObj:[3200,1300],vision:[26,8],dmgTakenPm:[820,180],timeDead:[6.8,3.2],soloKills:[1.1,0.9],multiKills:[0.3,0.5] }, loss:{ kda:[2.2,1.2],dmgPm:[860,210],goldPm:[420,50],csAt14:[96,14],csDiffAt14:[0,14],dmgObj:[2600,1100],vision:[22,8],dmgTakenPm:[920,200],timeDead:[11.8,4.0],soloKills:[0.5,0.7],multiKills:[0.1,0.3] } } },
    adc:     { 'diamond+': { win:{ kda:[4.8,1.9],dmgPm:[1180,260],goldPm:[510,55],csAt14:[118,14],csDiffAt14:[0,14],dmgObj:[4200,1500],vision:[16,5],dmgTakenPm:[660,170],timeDead:[6.2,2.9],soloKills:[0.3,0.5],multiKills:[0.5,0.6] }, loss:{ kda:[2.1,1.2],dmgPm:[940,220],goldPm:[450,50],csAt14:[108,14],csDiffAt14:[0,14],dmgObj:[3400,1300],vision:[14,5],dmgTakenPm:[720,180],timeDead:[12.0,4.0],soloKills:[0.2,0.4],multiKills:[0.2,0.4] } } },
    support: { 'diamond+': { win:{ kda:[5.4,1.9],dmgPm:[420,140],goldPm:[350,40],csAt14:[14,8],csDiffAt14:[0,4],dmgObj:[540,280],vision:[56,12],dmgTakenPm:[580,160],timeDead:[6.8,3.2],soloKills:[0.0,0.2],multiKills:[0.0,0.2] }, loss:{ kda:[2.5,1.2],dmgPm:[340,120],goldPm:[320,40],csAt14:[12,8],csDiffAt14:[0,4],dmgObj:[420,260],vision:[48,12],dmgTakenPm:[640,180],timeDead:[12.4,4.0],soloKills:[0.0,0.2],multiKills:[0.0,0.2] } } },
  };

  // ---- Public API -------------------------------------------------------
  function cohortFor(champion, lane, bracket, result) {
    const key = result ? 'win' : 'loss';
    const c = COHORTS[champion] && COHORTS[champion][lane] && COHORTS[champion][lane][bracket];
    if (c && c[key]) return c[key];
    const g = LANE_GLOBAL[lane] && LANE_GLOBAL[lane][bracket];
    return g && g[key] ? g[key] : null;
  }

  window.AIScoreData = {
    PATCH,
    BRACKET,
    MATCHES,
    COHORTS,
    LANE_GLOBAL,
    cohortFor,
  };
})();
