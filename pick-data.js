/**
 * pick-data.js — Dummy data for the pick-recommend prototype.
 *
 * In production this is replaced by the API response from
 * `POST /api/pick-recommend`'s upstream stores (champion meta JSON,
 * matchup matrix, synergy matrix, tier table). See docs/pick-recommend-spec.md §8.
 *
 * The shape here mirrors what the engine expects, so swapping data sources
 * later requires no engine changes.
 */
(function () {
  'use strict';

  const PATCH = '26.09';
  const BRACKET = 'diamond+';

  // ---- 30 champion meta tags ----------------------------------------------
  // Curated by hand for the prototype. Real version: 170 champs from
  // Phase 4.1 (docs/pick-recommend-spec.md §8.1).
  const CHAMPIONS = {
    // -- MID (11) --
    Azir:     { nameKr: '아지르',   lanes: ['mid'],         damageType: 'AP', role: ['Mage'],              ccLevel: 2, engageType: 'soft', scaling: 'late',  waveClear: 3, blindPickSafe: false, difficulty: 9, archetypeAffinity: ['poke','protect'] },
    Ahri:     { nameKr: '아리',     lanes: ['mid'],         damageType: 'AP', role: ['Mage','Assassin'],   ccLevel: 1, engageType: 'pick', scaling: 'mid',   waveClear: 2, blindPickSafe: true,  difficulty: 5, archetypeAffinity: ['pick'] },
    Orianna:  { nameKr: '오리아나', lanes: ['mid'],         damageType: 'AP', role: ['Mage'],              ccLevel: 2, engageType: 'soft', scaling: 'late',  waveClear: 2, blindPickSafe: true,  difficulty: 7, archetypeAffinity: ['engage','poke'] },
    Sylas:    { nameKr: '사일러스', lanes: ['mid'],         damageType: 'AP', role: ['Assassin','Bruiser'],ccLevel: 1, engageType: 'hard', scaling: 'mid',   waveClear: 2, blindPickSafe: false, difficulty: 7, archetypeAffinity: ['engage','pick'] },
    Yasuo:    { nameKr: '야스오',   lanes: ['mid','top'],   damageType: 'AD', role: ['Assassin','Bruiser'],ccLevel: 1, engageType: 'hard', scaling: 'mid',   waveClear: 2, blindPickSafe: false, difficulty: 10, archetypeAffinity: ['engage'] },
    Akali:    { nameKr: '아칼리',   lanes: ['mid','top'],   damageType: 'AP', role: ['Assassin'],          ccLevel: 0, engageType: 'pick', scaling: 'mid',   waveClear: 2, blindPickSafe: false, difficulty: 8, archetypeAffinity: ['pick'] },
    Kassadin: { nameKr: '카사딘',   lanes: ['mid'],         damageType: 'AP', role: ['Assassin'],          ccLevel: 1, engageType: 'pick', scaling: 'late',  waveClear: 1, blindPickSafe: true,  difficulty: 8, archetypeAffinity: ['pick','protect'] },
    Veigar:   { nameKr: '베이가',   lanes: ['mid'],         damageType: 'AP', role: ['Mage'],              ccLevel: 2, engageType: 'pick', scaling: 'late',  waveClear: 2, blindPickSafe: true,  difficulty: 5, archetypeAffinity: ['protect','pick'] },
    Anivia:   { nameKr: '애니비아', lanes: ['mid'],         damageType: 'AP', role: ['Mage'],              ccLevel: 2, engageType: 'soft', scaling: 'late',  waveClear: 3, blindPickSafe: true,  difficulty: 6, archetypeAffinity: ['poke','protect'] },
    Galio:    { nameKr: '갈리오',   lanes: ['mid'],         damageType: 'AP', role: ['Tank','Mage'],       ccLevel: 3, engageType: 'hard', scaling: 'mid',   waveClear: 2, blindPickSafe: true,  difficulty: 5, archetypeAffinity: ['engage'] },
    Hwei:     { nameKr: '흐웨이',   lanes: ['mid'],         damageType: 'AP', role: ['Mage'],              ccLevel: 2, engageType: 'soft', scaling: 'late',  waveClear: 3, blindPickSafe: false, difficulty: 10, archetypeAffinity: ['poke','pick'] },

    // -- TOP (6) --
    Aatrox:    { nameKr: '아트록스', lanes: ['top'],        damageType: 'AD', role: ['Bruiser'],           ccLevel: 2, engageType: 'hard', scaling: 'mid',   waveClear: 1, blindPickSafe: false, difficulty: 4, archetypeAffinity: ['engage','split'] },
    Malphite:  { nameKr: '말파이트', lanes: ['top'],        damageType: 'AP', role: ['Tank'],              ccLevel: 3, engageType: 'hard', scaling: 'mid',   waveClear: 1, blindPickSafe: true,  difficulty: 2, archetypeAffinity: ['engage'] },
    Jax:       { nameKr: '잭스',    lanes: ['top'],        damageType: 'AD', role: ['Bruiser'],           ccLevel: 1, engageType: 'soft', scaling: 'late',  waveClear: 1, blindPickSafe: true,  difficulty: 5, archetypeAffinity: ['split'] },
    Gangplank: { nameKr: '갱플랭크',lanes: ['top'],        damageType: 'AD', role: ['Bruiser'],           ccLevel: 0, engageType: 'pick', scaling: 'late',  waveClear: 3, blindPickSafe: false, difficulty: 9, archetypeAffinity: ['poke','split'] },
    Irelia:    { nameKr: '이렐리아',lanes: ['top','mid'],  damageType: 'AD', role: ['Bruiser','Assassin'],ccLevel: 1, engageType: 'hard', scaling: 'mid',   waveClear: 2, blindPickSafe: false, difficulty: 8, archetypeAffinity: ['split','engage'] },
    Garen:     { nameKr: '가렌',    lanes: ['top'],        damageType: 'AD', role: ['Bruiser','Tank'],    ccLevel: 1, engageType: 'soft', scaling: 'mid',   waveClear: 1, blindPickSafe: true,  difficulty: 1, archetypeAffinity: ['engage'] },

    // -- JUNGLE (5) --
    Graves:    { nameKr: '그레이브즈',lanes: ['jungle'],     damageType: 'AD', role: ['Marksman','Bruiser'],ccLevel: 0, engageType: 'soft', scaling: 'mid',   waveClear: 1, blindPickSafe: true,  difficulty: 4, archetypeAffinity: ['split'] },
    Vi:        { nameKr: '바이',     lanes: ['jungle'],    damageType: 'AD', role: ['Bruiser'],           ccLevel: 2, engageType: 'pick', scaling: 'mid',   waveClear: 0, blindPickSafe: true,  difficulty: 4, archetypeAffinity: ['pick','engage'] },
    Khazix:    { nameKr: '카직스',  lanes: ['jungle'],     damageType: 'AD', role: ['Assassin'],          ccLevel: 0, engageType: 'pick', scaling: 'mid',   waveClear: 0, blindPickSafe: false, difficulty: 6, archetypeAffinity: ['pick'] },
    LeeSin:    { nameKr: '리신',    lanes: ['jungle'],     damageType: 'AD', role: ['Bruiser'],           ccLevel: 2, engageType: 'hard', scaling: 'early', waveClear: 1, blindPickSafe: false, difficulty: 6, archetypeAffinity: ['engage','pick'] },
    Viego:     { nameKr: '비에고',  lanes: ['jungle'],     damageType: 'AD', role: ['Assassin','Bruiser'],ccLevel: 1, engageType: 'pick', scaling: 'mid',   waveClear: 1, blindPickSafe: false, difficulty: 7, archetypeAffinity: ['pick'] },

    // -- ADC (4) --
    Caitlyn:   { nameKr: '케이틀린',lanes: ['adc'],        damageType: 'AD', role: ['Marksman'],          ccLevel: 1, engageType: 'pick', scaling: 'late',  waveClear: 1, blindPickSafe: true,  difficulty: 6, archetypeAffinity: ['poke','protect'] },
    Jhin:      { nameKr: '진',      lanes: ['adc'],        damageType: 'AD', role: ['Marksman'],          ccLevel: 2, engageType: 'pick', scaling: 'mid',   waveClear: 1, blindPickSafe: true,  difficulty: 6, archetypeAffinity: ['poke','pick'] },
    Ezreal:    { nameKr: '이즈리얼',lanes: ['adc'],        damageType: 'AD', role: ['Marksman'],          ccLevel: 0, engageType: 'pick', scaling: 'late',  waveClear: 1, blindPickSafe: true,  difficulty: 7, archetypeAffinity: ['poke'] },
    Zeri:      { nameKr: '제리',    lanes: ['adc'],        damageType: 'AD', role: ['Marksman'],          ccLevel: 0, engageType: 'soft', scaling: 'late',  waveClear: 2, blindPickSafe: false, difficulty: 8, archetypeAffinity: ['protect'] },

    // -- SUPPORT (4) --
    Thresh:    { nameKr: '쓰레쉬',  lanes: ['support'],    damageType: 'AP', role: ['Support'],           ccLevel: 3, engageType: 'pick', scaling: 'mid',   waveClear: 0, blindPickSafe: true,  difficulty: 7, archetypeAffinity: ['engage','pick'] },
    Nautilus:  { nameKr: '노틸러스',lanes: ['support'],    damageType: 'AP', role: ['Tank','Support'],    ccLevel: 3, engageType: 'hard', scaling: 'mid',   waveClear: 0, blindPickSafe: true,  difficulty: 6, archetypeAffinity: ['engage'] },
    Lulu:      { nameKr: '룰루',    lanes: ['support'],    damageType: 'AP', role: ['Support','Enchanter'],ccLevel: 2, engageType: 'none', scaling: 'mid',  waveClear: 0, blindPickSafe: true,  difficulty: 5, archetypeAffinity: ['protect'] },
    Renata:    { nameKr: '레나타',  lanes: ['support'],    damageType: 'AP', role: ['Support','Enchanter'],ccLevel: 2, engageType: 'none', scaling: 'mid',  waveClear: 0, blindPickSafe: true,  difficulty: 7, archetypeAffinity: ['protect'] },
  };

  // ---- Tier table per lane (PS Score, winrate, pickrate, banrate, sample N)
  // Per docs/pick-recommend-spec.md §5.2 M_meta formula.
  const TIER_AVG_WR = { top: 50.3, jungle: 50.1, mid: 50.2, adc: 50.0, support: 50.1 };

  const TIER_DATA = {
    Azir:      { mid: { wr: 50.85, pickrate: 4.21, banrate: 12.4, n: 10532, psScore: 52.42 } },
    Ahri:      { mid: { wr: 51.4,  pickrate: 8.2,  banrate: 4.5,  n: 21042, psScore: 53.1  } },
    Orianna:   { mid: { wr: 51.42, pickrate: 3.84, banrate: 5.21, n: 9612,  psScore: 51.94 } },
    Sylas:     { mid: { wr: 50.1,  pickrate: 6.5,  banrate: 9.8,  n: 16240, psScore: 51.8  } },
    Yasuo:     { mid: { wr: 49.5,  pickrate: 8.1,  banrate: 22.4, n: 20810, psScore: 50.9  }, top: { wr: 49.0, pickrate: 2.1, banrate: 22.4, n: 5240, psScore: 49.5 } },
    Akali:     { mid: { wr: 50.4,  pickrate: 5.8,  banrate: 11.2, n: 14820, psScore: 52.3  } },
    Kassadin:  { mid: { wr: 50.2,  pickrate: 3.5,  banrate: 6.4,  n: 8920,  psScore: 50.5  } },
    Veigar:    { mid: { wr: 51.82, pickrate: 2.47, banrate: 2.18, n: 6182,  psScore: 51.72 } },
    Anivia:    { mid: { wr: 52.76, pickrate: 2.19, banrate: 6.27, n: 5485,  psScore: 52.94 } },
    Galio:     { mid: { wr: 50.8,  pickrate: 1.8,  banrate: 1.5,  n: 4520,  psScore: 50.4  } },
    Hwei:      { mid: { wr: 49.2,  pickrate: 4.5,  banrate: 8.1,  n: 11240, psScore: 50.0  } },

    Aatrox:    { top: { wr: 50.6,  pickrate: 5.4,  banrate: 7.2,  n: 13420, psScore: 51.4  } },
    Malphite:  { top: { wr: 51.15, pickrate: 6.53, banrate: 20.29,n: 16327, psScore: 55.25 } },
    Jax:       { top: { wr: 50.21, pickrate: 6.47, banrate: 15.09,n: 16174, psScore: 54.33 } },
    Gangplank: { top: { wr: 52.88, pickrate: 3.76, banrate: 8.12, n: 9411,  psScore: 55.33 } },
    Irelia:    { top: { wr: 50.94, pickrate: 5.76, banrate: 27.76,n: 14400, psScore: 54.93 }, mid: { wr: 49.2, pickrate: 1.2, banrate: 27.76, n: 3020, psScore: 50.0 } },
    Garen:     { top: { wr: 51.2,  pickrate: 4.0,  banrate: 1.5,  n: 9920,  psScore: 51.0  } },

    Graves:    { jungle: { wr: 51.5, pickrate: 6.8,  banrate: 8.4, n: 17040, psScore: 53.2 } },
    Vi:        { jungle: { wr: 50.8, pickrate: 4.2,  banrate: 3.5, n: 10520, psScore: 51.4 } },
    Khazix:    { jungle: { wr: 51.2, pickrate: 5.5,  banrate: 7.2, n: 13820, psScore: 52.4 } },
    LeeSin:    { jungle: { wr: 49.4, pickrate: 9.1,  banrate: 6.8, n: 22790, psScore: 50.2 } },
    Viego:     { jungle: { wr: 50.4, pickrate: 7.3,  banrate: 9.4, n: 18280, psScore: 51.5 } },

    Caitlyn:   { adc: { wr: 51.8, pickrate: 12.4, banrate: 8.2, n: 31090, psScore: 53.6 } },
    Jhin:      { adc: { wr: 52.2, pickrate: 11.2, banrate: 5.4, n: 28030, psScore: 53.1 } },
    Ezreal:    { adc: { wr: 49.8, pickrate: 13.5, banrate: 4.2, n: 33820, psScore: 51.0 } },
    Zeri:      { adc: { wr: 50.4, pickrate: 6.8,  banrate: 8.5, n: 17040, psScore: 51.6 } },

    Thresh:    { support: { wr: 50.5, pickrate: 12.3, banrate: 6.4, n: 30810, psScore: 52.0 } },
    Nautilus:  { support: { wr: 51.0, pickrate: 10.2, banrate: 5.2, n: 25540, psScore: 52.2 } },
    Lulu:      { support: { wr: 51.4, pickrate: 6.5,  banrate: 3.1, n: 16280, psScore: 52.4 } },
    Renata:    { support: { wr: 50.8, pickrate: 4.2,  banrate: 2.8, n: 10520, psScore: 51.2 } },
  };

  // ---- Previous patch snapshot (for trend detection) ----------------------
  // Same shape as TIER_DATA. In production: nightly snapshot kept for ~30 days.
  const TIER_DATA_PREV = {
    Azir:      { mid: { wr: 50.10, pickrate: 3.80, banrate: 11.8, n: 9420 } },
    Ahri:      { mid: { wr: 51.20, pickrate: 8.40, banrate: 4.20, n: 20210 } },
    Orianna:   { mid: { wr: 50.60, pickrate: 4.20, banrate: 5.80, n: 9810 } },
    Sylas:     { mid: { wr: 49.40, pickrate: 6.20, banrate: 8.40, n: 15820 } },
    Yasuo:     { mid: { wr: 49.10, pickrate: 9.20, banrate: 24.8, n: 22420 }, top: { wr: 48.40, pickrate: 2.40, banrate: 24.8, n: 5410 } },
    Akali:     { mid: { wr: 49.80, pickrate: 6.40, banrate: 12.5, n: 15240 } },
    Kassadin:  { mid: { wr: 49.50, pickrate: 3.20, banrate: 5.80, n: 8210 } },
    Veigar:    { mid: { wr: 51.40, pickrate: 2.30, banrate: 1.90, n: 5980 } },
    Anivia:    { mid: { wr: 51.20, pickrate: 1.40, banrate: 4.20, n: 3580 } },
    Galio:     { mid: { wr: 50.20, pickrate: 1.90, banrate: 1.20, n: 4720 } },
    Hwei:      { mid: { wr: 48.40, pickrate: 5.20, banrate: 9.40, n: 12810 } },

    Aatrox:    { top: { wr: 51.40, pickrate: 6.10, banrate: 8.40, n: 14820 } },
    Malphite:  { top: { wr: 49.20, pickrate: 4.80, banrate: 18.4, n: 12010 } },
    Jax:       { top: { wr: 49.80, pickrate: 6.20, banrate: 17.4, n: 15580 } },
    Gangplank: { top: { wr: 50.50, pickrate: 3.10, banrate: 6.40, n: 7820 } },
    Irelia:    { top: { wr: 51.40, pickrate: 6.10, banrate: 26.20,n: 15240 }, mid: { wr: 49.50, pickrate: 1.40, banrate: 26.20, n: 3520 } },
    Garen:     { top: { wr: 51.80, pickrate: 4.20, banrate: 1.40, n: 10410 } },

    Graves:    { jungle: { wr: 51.20, pickrate: 7.10, banrate: 7.80, n: 17810 } },
    Vi:        { jungle: { wr: 50.40, pickrate: 4.50, banrate: 3.20, n: 11240 } },
    Khazix:    { jungle: { wr: 50.80, pickrate: 5.80, banrate: 6.80, n: 14520 } },
    LeeSin:    { jungle: { wr: 49.60, pickrate: 9.40, banrate: 6.20, n: 23510 } },
    Viego:     { jungle: { wr: 50.10, pickrate: 7.60, banrate: 9.10, n: 18920 } },

    Caitlyn:   { adc: { wr: 51.20, pickrate: 11.80, banrate: 7.40, n: 29420 } },
    Jhin:      { adc: { wr: 52.40, pickrate: 11.40, banrate: 5.20, n: 28510 } },
    Ezreal:    { adc: { wr: 49.40, pickrate: 14.20, banrate: 4.40, n: 35610 } },
    Zeri:      { adc: { wr: 49.20, pickrate: 7.20, banrate: 8.20, n: 18020 } },

    Thresh:    { support: { wr: 50.20, pickrate: 12.80, banrate: 6.10, n: 32010 } },
    Nautilus:  { support: { wr: 50.40, pickrate: 10.80, banrate: 4.80, n: 27040 } },
    Lulu:      { support: { wr: 50.80, pickrate: 6.10, banrate: 2.80, n: 15280 } },
    Renata:    { support: { wr: 50.40, pickrate: 4.10, banrate: 2.40, n: 10240 } },
  };

  // ---- Lane matchups (champion vs same-lane enemy) ------------------------
  // Sparse: only "interesting" matchups per lane. Engine treats missing
  // matchups as 50% with N=0 (low confidence).
  const MATCHUPS = {
    mid: {
      Azir:    { Yasuo: { wr: 46.8, n: 824 }, Sylas: { wr: 47.5, n: 1102 }, Veigar: { wr: 56.2, n: 412 }, Kassadin: { wr: 54.0, n: 580 }, Anivia: { wr: 52.8, n: 280 }, Akali: { wr: 47.2, n: 690 }, Hwei: { wr: 51.0, n: 320 } },
      Ahri:    { Yasuo: { wr: 51.2, n: 1240 }, Sylas: { wr: 49.5, n: 980 }, Veigar: { wr: 53.4, n: 540 }, Kassadin: { wr: 47.8, n: 720 }, Akali: { wr: 50.2, n: 880 }, Orianna: { wr: 49.8, n: 410 } },
      Orianna: { Yasuo: { wr: 49.0, n: 760 }, Sylas: { wr: 48.5, n: 612 }, Veigar: { wr: 52.4, n: 388 }, Akali: { wr: 47.8, n: 540 }, Anivia: { wr: 51.2, n: 220 } },
      Sylas:   { Azir: { wr: 52.5, n: 1102 }, Veigar: { wr: 54.8, n: 480 }, Kassadin: { wr: 51.4, n: 620 }, Anivia: { wr: 53.0, n: 340 }, Orianna: { wr: 51.5, n: 612 } },
      Yasuo:   { Azir: { wr: 53.2, n: 824 }, Veigar: { wr: 52.0, n: 510 }, Kassadin: { wr: 47.5, n: 680 }, Anivia: { wr: 49.8, n: 420 } },
      Akali:   { Azir: { wr: 52.8, n: 690 }, Orianna: { wr: 52.2, n: 540 }, Veigar: { wr: 53.5, n: 380 }, Kassadin: { wr: 51.0, n: 460 } },
      Kassadin:{ Azir: { wr: 46.0, n: 580 }, Yasuo: { wr: 52.5, n: 680 }, Veigar: { wr: 49.8, n: 320 }, Anivia: { wr: 48.0, n: 240 } },
      Veigar:  { Azir: { wr: 43.8, n: 412 }, Yasuo: { wr: 48.0, n: 510 }, Akali: { wr: 46.5, n: 380 }, Kassadin: { wr: 50.2, n: 320 } },
      Anivia:  { Azir: { wr: 47.2, n: 280 }, Sylas: { wr: 47.0, n: 340 }, Yasuo: { wr: 50.2, n: 420 }, Kassadin: { wr: 52.0, n: 240 } },
      Galio:   { Yasuo: { wr: 53.0, n: 380 }, Sylas: { wr: 51.8, n: 410 }, Akali: { wr: 52.4, n: 290 } },
      Hwei:    { Azir: { wr: 49.0, n: 320 }, Sylas: { wr: 49.5, n: 410 } },
    },
    top: {
      Aatrox:    { Malphite: { wr: 47.5, n: 540 }, Jax: { wr: 48.8, n: 620 }, Gangplank: { wr: 50.2, n: 380 }, Irelia: { wr: 51.4, n: 720 }, Garen: { wr: 53.2, n: 290 }, Yasuo: { wr: 53.0, n: 410 } },
      Malphite:  { Aatrox: { wr: 52.5, n: 540 }, Jax: { wr: 49.5, n: 480 }, Gangplank: { wr: 53.5, n: 320 }, Irelia: { wr: 54.0, n: 580 }, Yasuo: { wr: 56.0, n: 360 } },
      Jax:       { Aatrox: { wr: 51.2, n: 620 }, Malphite: { wr: 50.5, n: 480 }, Gangplank: { wr: 49.8, n: 410 }, Irelia: { wr: 51.0, n: 540 }, Garen: { wr: 53.0, n: 280 } },
      Gangplank: { Aatrox: { wr: 49.8, n: 380 }, Malphite: { wr: 46.5, n: 320 }, Jax: { wr: 50.2, n: 410 }, Irelia: { wr: 48.5, n: 360 }, Garen: { wr: 54.0, n: 240 } },
      Irelia:    { Aatrox: { wr: 48.6, n: 720 }, Malphite: { wr: 46.0, n: 580 }, Jax: { wr: 49.0, n: 540 }, Gangplank: { wr: 51.5, n: 360 } },
      Garen:     { Aatrox: { wr: 46.8, n: 290 }, Jax: { wr: 47.0, n: 280 }, Gangplank: { wr: 46.0, n: 240 } },
    },
    jungle: {
      Graves: { Vi: { wr: 53.0, n: 480 }, Khazix: { wr: 49.5, n: 620 }, LeeSin: { wr: 51.5, n: 740 }, Viego: { wr: 50.0, n: 540 } },
      Vi:     { Graves: { wr: 47.0, n: 480 }, Khazix: { wr: 51.5, n: 410 }, LeeSin: { wr: 50.5, n: 580 }, Viego: { wr: 51.0, n: 420 } },
      Khazix: { Graves: { wr: 50.5, n: 620 }, Vi: { wr: 48.5, n: 410 }, LeeSin: { wr: 50.0, n: 510 }, Viego: { wr: 51.0, n: 380 } },
      LeeSin: { Graves: { wr: 48.5, n: 740 }, Vi: { wr: 49.5, n: 580 }, Viego: { wr: 49.5, n: 510 } },
      Viego:  { Graves: { wr: 50.0, n: 540 }, Vi: { wr: 49.0, n: 420 }, Khazix: { wr: 49.0, n: 380 }, LeeSin: { wr: 50.5, n: 510 } },
    },
    adc: {
      Caitlyn: { Jhin: { wr: 51.5, n: 1240 }, Ezreal: { wr: 53.0, n: 1480 }, Zeri: { wr: 50.5, n: 720 } },
      Jhin:    { Caitlyn: { wr: 48.5, n: 1240 }, Ezreal: { wr: 52.0, n: 1380 }, Zeri: { wr: 51.5, n: 680 } },
      Ezreal:  { Caitlyn: { wr: 47.0, n: 1480 }, Jhin: { wr: 48.0, n: 1380 }, Zeri: { wr: 49.5, n: 740 } },
      Zeri:    { Caitlyn: { wr: 49.5, n: 720 }, Jhin: { wr: 48.5, n: 680 }, Ezreal: { wr: 50.5, n: 740 } },
    },
    support: {
      Thresh:   { Nautilus: { wr: 50.0, n: 1240 }, Lulu: { wr: 51.5, n: 920 }, Renata: { wr: 50.8, n: 540 } },
      Nautilus: { Thresh: { wr: 50.0, n: 1240 }, Lulu: { wr: 50.5, n: 880 }, Renata: { wr: 50.2, n: 480 } },
      Lulu:     { Thresh: { wr: 48.5, n: 920 }, Nautilus: { wr: 49.5, n: 880 }, Renata: { wr: 50.0, n: 380 } },
      Renata:   { Thresh: { wr: 49.2, n: 540 }, Nautilus: { wr: 49.8, n: 480 }, Lulu: { wr: 50.0, n: 380 } },
    },
  };

  // ---- Synergy matrix (same team, lane-agnostic) --------------------------
  const SYNERGIES = {
    Azir:     { Renata: { wr: 53.2, n: 184 }, Lulu: { wr: 54.0, n: 220 }, Malphite: { wr: 53.5, n: 240 }, Nautilus: { wr: 52.4, n: 290 } },
    Ahri:     { Thresh: { wr: 52.0, n: 320 }, Nautilus: { wr: 52.8, n: 410 }, Aatrox: { wr: 51.5, n: 280 } },
    Orianna:  { Malphite: { wr: 56.0, n: 380 }, Nautilus: { wr: 53.4, n: 460 }, Aatrox: { wr: 52.8, n: 320 } },
    Sylas:    { Lulu: { wr: 52.0, n: 240 }, Renata: { wr: 51.5, n: 180 } },
    Yasuo:    { Malphite: { wr: 56.5, n: 420 }, Aatrox: { wr: 51.0, n: 320 }, Galio: { wr: 53.5, n: 280 }, Vi: { wr: 52.5, n: 340 } },
    Akali:    { Nautilus: { wr: 52.0, n: 280 }, Thresh: { wr: 51.5, n: 240 } },
    Kassadin: { Lulu: { wr: 53.5, n: 220 }, Nautilus: { wr: 52.0, n: 320 }, Renata: { wr: 53.0, n: 180 } },
    Veigar:   { Thresh: { wr: 52.0, n: 280 }, Nautilus: { wr: 52.5, n: 320 } },
    Anivia:   { Lulu: { wr: 53.0, n: 220 }, Renata: { wr: 53.5, n: 180 } },
    Galio:    { Yasuo: { wr: 53.5, n: 280 }, Aatrox: { wr: 52.0, n: 240 }, Khazix: { wr: 51.5, n: 220 } },
    Hwei:     { Renata: { wr: 53.0, n: 180 }, Lulu: { wr: 52.5, n: 220 } },

    Aatrox:    { Orianna: { wr: 52.8, n: 320 }, Yasuo: { wr: 51.0, n: 320 }, Galio: { wr: 52.0, n: 240 }, Lulu: { wr: 51.5, n: 280 } },
    Malphite:  { Yasuo: { wr: 56.5, n: 420 }, Orianna: { wr: 56.0, n: 380 }, Azir: { wr: 53.5, n: 240 } },
    Jax:       { Lulu: { wr: 54.0, n: 320 }, Renata: { wr: 52.5, n: 220 } },
    Gangplank: { Renata: { wr: 53.0, n: 180 }, Nautilus: { wr: 52.5, n: 240 } },
    Irelia:    { Vi: { wr: 53.0, n: 280 }, Khazix: { wr: 52.0, n: 240 } },
    Garen:     { Vi: { wr: 52.0, n: 220 } },

    Graves:    { Aatrox: { wr: 51.5, n: 320 }, Khazix: { wr: 51.0, n: 280 } },
    Vi:        { Yasuo: { wr: 52.5, n: 340 }, Irelia: { wr: 53.0, n: 280 }, Galio: { wr: 51.5, n: 240 } },
    Khazix:    { Galio: { wr: 51.5, n: 220 }, Irelia: { wr: 52.0, n: 240 }, Graves: { wr: 51.0, n: 280 } },
    LeeSin:    { Akali: { wr: 51.5, n: 220 } },
    Viego:     { Lulu: { wr: 52.0, n: 240 } },

    Caitlyn:   { Lulu: { wr: 53.5, n: 480 }, Renata: { wr: 52.0, n: 380 } },
    Jhin:      { Thresh: { wr: 52.5, n: 440 }, Nautilus: { wr: 52.0, n: 380 } },
    Ezreal:    { Renata: { wr: 53.0, n: 320 }, Lulu: { wr: 52.5, n: 360 }, Thresh: { wr: 51.0, n: 420 } },
    Zeri:      { Lulu: { wr: 56.0, n: 320 }, Renata: { wr: 54.5, n: 240 } },

    Thresh:    { Jhin: { wr: 52.5, n: 440 }, Ahri: { wr: 52.0, n: 320 }, Ezreal: { wr: 51.0, n: 420 } },
    Nautilus:  { Orianna: { wr: 53.4, n: 460 }, Ahri: { wr: 52.8, n: 410 }, Jhin: { wr: 52.0, n: 380 } },
    Lulu:      { Zeri: { wr: 56.0, n: 320 }, Caitlyn: { wr: 53.5, n: 480 }, Jax: { wr: 54.0, n: 320 }, Azir: { wr: 54.0, n: 220 } },
    Renata:    { Azir: { wr: 53.2, n: 184 }, Zeri: { wr: 54.5, n: 240 }, Ezreal: { wr: 53.0, n: 320 } },
  };

  // ---- Static curation ----------------------------------------------------
  const BLIND_PICK_SAFE = ['Malphite', 'Jax', 'Garen', 'Ahri', 'Veigar', 'Galio', 'Anivia', 'Caitlyn', 'Jhin', 'Lulu', 'Nautilus', 'Thresh', 'Renata', 'Graves', 'Vi'];

  // Override Riot's `info.difficulty` where it's misleading
  const DIFFICULTY_OVERRIDES = {
    Irelia:  { difficulty: 8, reason: '실제 마스터리 곡선 가파름' },
    Riven:   { difficulty: 9, reason: '콤보 캔슬 숙련도 필수' },
    Hwei:    { difficulty: 10, reason: 'ddragon 미정, 스킬 11개' },
    Akali:   { difficulty: 8, reason: '매치업별 빌드 다양' },
    Yasuo:   { difficulty: 10, reason: '유지' },
    Azir:    { difficulty: 9, reason: '병사 컨트롤 + 콤보' },
    Gangplank:{ difficulty: 9, reason: '통 컨트롤 + 글로벌 ult' },
  };

  // ---- Mock per-player season stats (for mastery info display only) -------
  // In production: from MATCH-V5 season aggregation per PUUID.
  const MOCK_SEASON_GAMES = {
    Azir: 47, Ahri: 18, Orianna: 9, Sylas: 23, Yasuo: 0,
    Akali: 4, Kassadin: 12, Veigar: 2, Anivia: 0, Galio: 6, Hwei: 0,
    Aatrox: 8, Malphite: 0, Jax: 14, Gangplank: 0, Irelia: 22, Garen: 1,
    Graves: 5, Vi: 11, Khazix: 0, LeeSin: 18, Viego: 7,
    Caitlyn: 16, Jhin: 9, Ezreal: 4, Zeri: 0,
    Thresh: 6, Nautilus: 12, Lulu: 3, Renata: 0,
  };

  // ---- Bot duo synergy (ADC <-> Support specific) -------------------------
  // Sparser & more accurate than the lane-agnostic SYNERGIES.
  // Format: BOT_DUO_SYNERGY[adcKey][supKey] = { wr, n, delta, archetype }
  // Symmetric lookup: helpers below normalize the call site.
  const BOT_DUO_SYNERGY = {
    Caitlyn: {
      Lulu:     { wr: 53.8, n: 484, delta: +2.1, archetype: 'protect' },
      Morgana:  { wr: 52.4, n: 388, delta: +1.4, archetype: 'poke' },
      Renata:   { wr: 52.0, n: 312, delta: +1.0, archetype: 'protect' },
      Nautilus: { wr: 50.8, n: 280, delta: -0.4, archetype: 'engage' },
      Thresh:   { wr: 50.5, n: 240, delta: -0.6, archetype: 'pick' },
    },
    Jhin: {
      Thresh:   { wr: 53.0, n: 442, delta: +1.8, archetype: 'pick' },
      Nautilus: { wr: 52.4, n: 380, delta: +1.4, archetype: 'engage' },
      Renata:   { wr: 51.6, n: 220, delta: +0.6, archetype: 'protect' },
      Lulu:     { wr: 50.5, n: 180, delta: -0.4, archetype: 'protect' },
    },
    Ezreal: {
      Renata:   { wr: 53.2, n: 324, delta: +2.2, archetype: 'protect' },
      Lulu:     { wr: 52.8, n: 360, delta: +1.6, archetype: 'protect' },
      Thresh:   { wr: 51.4, n: 422, delta: +0.4, archetype: 'pick' },
      Nautilus: { wr: 50.2, n: 280, delta: -0.6, archetype: 'engage' },
    },
    Zeri: {
      Lulu:     { wr: 56.2, n: 322, delta: +4.5, archetype: 'protect' },
      Renata:   { wr: 54.8, n: 244, delta: +3.0, archetype: 'protect' },
      Nautilus: { wr: 51.8, n: 162, delta: 0.0,  archetype: 'engage' },
      Thresh:   { wr: 50.4, n: 140, delta: -1.2, archetype: 'pick' },
    },
  };

  // Bot duo archetype tags (helps Composition card + reason text)
  const BOT_DUO_ARCHETYPES = {
    protect: { label: '프로텍트',  desc: '하이퍼캐리 + 보호 — 후반 캐리' },
    poke:    { label: '포크',      desc: '장거리 견제 — 시즈 / 타워 압박' },
    engage:  { label: '엔게이지',  desc: '하드 엔게이지 — 5v5 강제' },
    pick:    { label: '픽',        desc: '단일 타겟 끊어먹기 — 중반' },
    sustain: { label: '서스테인',  desc: '회복 + 스케일링 — 후반' },
    onhit:   { label: '온힛',      desc: '온힛 스테로이드 + 버퍼' },
    killlane:{ label: '킬레인',    desc: '초반 올인 — 라인전 우위' },
  };

  // ---- Co-pick priors: P(partner | anchor) for missing-pick prediction ----
  // Format: COPICK_PROBS[anchorChamp][partnerLane][partnerChamp] = prob (0..1)
  // Sparse — only "anchor" champs that strongly bias their team comp.
  // Engine falls back to lane meta priors when anchor not in this table.
  const COPICK_PROBS = {
    // Mid Yasuo strongly biases comp toward engage
    Yasuo: {
      jungle:  { Vi: 0.18, LeeSin: 0.14, Khazix: 0.12, Viego: 0.10, Graves: 0.08 },
      top:     { Malphite: 0.16, Aatrox: 0.12, Irelia: 0.10, Jax: 0.08, Garen: 0.06 },
      adc:     { Caitlyn: 0.13, Jhin: 0.11, Zeri: 0.10, Ezreal: 0.06 },
      support: { Nautilus: 0.18, Thresh: 0.13, Renata: 0.07, Lulu: 0.05 },
    },
    // Mid Azir → late-scaling protect comps
    Azir: {
      jungle:  { Graves: 0.14, Viego: 0.12, Vi: 0.10, Khazix: 0.08, LeeSin: 0.06 },
      top:     { Aatrox: 0.13, Jax: 0.12, Malphite: 0.11, Gangplank: 0.10, Irelia: 0.07 },
      adc:     { Ezreal: 0.13, Zeri: 0.12, Caitlyn: 0.11, Jhin: 0.08 },
      support: { Lulu: 0.20, Renata: 0.16, Nautilus: 0.10, Thresh: 0.06 },
    },
    // Top Malphite → engage wombo
    Malphite: {
      jungle:  { Vi: 0.16, Viego: 0.12, LeeSin: 0.10, Khazix: 0.07, Graves: 0.06 },
      mid:     { Yasuo: 0.18, Orianna: 0.14, Ahri: 0.10, Galio: 0.08, Sylas: 0.06 },
      adc:     { Caitlyn: 0.13, Jhin: 0.12, Zeri: 0.09, Ezreal: 0.07 },
      support: { Nautilus: 0.17, Thresh: 0.13, Renata: 0.06, Lulu: 0.04 },
    },
    // Bot Zeri → protect comp (Lulu/Renata partner heavy)
    Zeri: {
      support: { Lulu: 0.34, Renata: 0.22, Nautilus: 0.10, Thresh: 0.08 },
      mid:     { Azir: 0.14, Orianna: 0.12, Galio: 0.09, Ahri: 0.08 },
      jungle:  { Vi: 0.12, Graves: 0.10, Viego: 0.08 },
      top:     { Malphite: 0.14, Aatrox: 0.10, Jax: 0.08 },
    },
    // Support Lulu → enchanter protect comp
    Lulu: {
      adc:     { Zeri: 0.26, Caitlyn: 0.18, Jhin: 0.12, Ezreal: 0.10 },
      mid:     { Azir: 0.16, Orianna: 0.10, Veigar: 0.08 },
    },
  };

  // Lane meta priors used as fallback when anchor not in COPICK_PROBS.
  // Derived from each champion's pickrate at that lane (re-computed at load).
  function buildLaneMetaPriors() {
    const priors = { top: {}, jungle: {}, mid: {}, adc: {}, support: {} };
    Object.keys(TIER_DATA).forEach((c) => {
      Object.keys(TIER_DATA[c]).forEach((lane) => {
        const stats = TIER_DATA[c][lane];
        priors[lane][c] = stats.pickrate || 1;
      });
    });
    // normalize
    Object.keys(priors).forEach((lane) => {
      const total = Object.values(priors[lane]).reduce((a, b) => a + b, 0);
      if (total > 0) {
        Object.keys(priors[lane]).forEach((c) => { priors[lane][c] /= total; });
      }
    });
    return priors;
  }
  const LANE_META_PRIORS = buildLaneMetaPriors();

  // ---- Public API ---------------------------------------------------------

  function botDuoSynergy(adcKey, supKey) {
    if (!adcKey || !supKey) return null;
    return (BOT_DUO_SYNERGY[adcKey] && BOT_DUO_SYNERGY[adcKey][supKey]) || null;
  }

  window.PickData = {
    PATCH,
    BRACKET,
    CHAMPIONS,
    TIER_AVG_WR,
    TIER_DATA,
    TIER_DATA_PREV,
    MATCHUPS,
    SYNERGIES,
    BOT_DUO_SYNERGY,
    BOT_DUO_ARCHETYPES,
    COPICK_PROBS,
    LANE_META_PRIORS,
    BLIND_PICK_SAFE,
    DIFFICULTY_OVERRIDES,
    MOCK_SEASON_GAMES,

    // Helpers
    listChampions: () => Object.keys(CHAMPIONS),
    nameKr: (key) => CHAMPIONS[key] ? CHAMPIONS[key].nameKr : key,
    seasonGames: (key) => MOCK_SEASON_GAMES[key] || 0,
    isBlindSafe: (key) => BLIND_PICK_SAFE.includes(key),
    effectiveDifficulty: (key) => {
      if (DIFFICULTY_OVERRIDES[key]) return DIFFICULTY_OVERRIDES[key].difficulty;
      return CHAMPIONS[key] ? CHAMPIONS[key].difficulty : 5;
    },
    botDuoSynergy,
    laneMetaPrior: (champ, lane) => (LANE_META_PRIORS[lane] && LANE_META_PRIORS[lane][champ]) || 0,
    copickProb: (anchor, partnerLane, partner) => {
      const a = COPICK_PROBS[anchor];
      if (a && a[partnerLane] && a[partnerLane][partner] != null) return a[partnerLane][partner];
      return null;
    },
  };
})();
