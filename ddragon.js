/**
 * ddragon.js — Single source of truth for Riot Data Dragon CDN.
 *
 * Goals:
 *  - One place for the version constant.
 *  - Declarative HTML with `data-dd-*` attributes; JS rewrites src on load.
 *  - Graceful failure: bad URLs add a `failed` class so CSS shows the placeholder.
 *  - Consistent Korean → ddragon key mapping for prototype data.
 *
 * Usage in HTML:
 *   <img data-dd-champion="Aatrox" alt="아트록스">
 *   <img data-dd-champion-id="266" alt="">         (async resolves via meta)
 *   <img data-dd-item="3078" alt="삼위일체">
 *   <img data-dd-spell="SummonerFlash" alt="점멸">
 *   <img data-dd-spell-id="4" alt="">              (async resolves via meta)
 *   <img data-dd-rune-keystone="Domination/Electrocute" alt="감전">
 *   <img data-dd-profile-icon="29" alt="프로필 아이콘">
 *   <img data-dd-splash="Aatrox" alt="아트록스 스플래시">
 */
(function () {
  'use strict';

  // ---- Constants (the only place to edit) -------------------------------
  const FALLBACK_VERSION = '14.24.1';   // used if version fetch fails
  const FALLBACK_LOCALE = 'ko_KR';
  const BASE = 'https://ddragon.leagueoflegends.com';
  const CCDN_BASE = 'https://cdn.communitydragon.org/latest';
  const VERSIONS_URL = `${BASE}/api/versions.json`;
  const VERSION_CACHE_KEY = 'ddragon:version';
  const VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

  // ---- State ------------------------------------------------------------
  const state = {
    version: FALLBACK_VERSION,
    locale: FALLBACK_LOCALE,
    ready: false,
  };

  // ---- Meta (champion.json + summoner spells) — memoized, async ----------
  // {
  //   championIdToKey: { "266": "Aatrox", ... },
  //   championKeyToName: { "Aatrox": "아트록스", ... },
  //   spellIdToKey: { "4": "SummonerFlash", ... }  (numeric → API key)
  // }
  let metaPromise = null;

  function loadMeta() {
    if (metaPromise) return metaPromise;
    metaPromise = (async () => {
      const out = { championIdToKey: {}, championKeyToName: {}, spellIdToKey: {} };
      try {
        const champ = await fetch(`${BASE}/cdn/${state.version}/data/${state.locale}/champion.json`).then((r) => r.json());
        for (const c of Object.values(champ.data || {})) {
          out.championIdToKey[String(c.key)] = c.id;
          out.championKeyToName[c.id] = c.name;
        }
      } catch (e) { console.warn('[ddragon] champion.json fetch failed', e); }
      try {
        const sp = await fetch(`${BASE}/cdn/${state.version}/data/${state.locale}/summoner.json`).then((r) => r.json());
        for (const s of Object.values(sp.data || {})) {
          out.spellIdToKey[String(s.key)] = s.id;
        }
      } catch (e) { console.warn('[ddragon] summoner.json fetch failed', e); }
      return out;
    })();
    return metaPromise;
  }

  // ---- Champion key aliases (Riot returns legacy keys in some endpoints
  // but ddragon serves images at the canonical path). Add cases as found.
  const CHAMPION_KEY_ALIASES = {
    'FiddleSticks': 'Fiddlesticks',   // MATCH-V5 returns capital S; ddragon canonical is lowercase
  };
  function canonicalChampionKey(key) {
    return (CHAMPION_KEY_ALIASES[key]) || key;
  }

  // ---- URL builders -----------------------------------------------------
  const urls = {
    champion: (key) => `${BASE}/cdn/${state.version}/img/champion/${encodeURIComponent(canonicalChampionKey(key))}.png`,
    item: (id) => `${BASE}/cdn/${state.version}/img/item/${encodeURIComponent(id)}.png`,
    spell: (key) => `${BASE}/cdn/${state.version}/img/spell/${encodeURIComponent(key)}.png`,
    profileIcon: (id) => `${BASE}/cdn/${state.version}/img/profileicon/${encodeURIComponent(id)}.png`,
    // Splash and rune images are NOT versioned.
    splash: (key) => `${BASE}/cdn/img/champion/splash/${encodeURIComponent(canonicalChampionKey(key))}_0.jpg`,
    runeKeystone: (path) => `${BASE}/cdn/img/perk-images/Styles/${path}.png`,
    // Community Dragon: useful for square champion tiles & rune fallback.
    championSquareCCDN: (key) =>
      `${CCDN_BASE}/champion/${canonicalChampionKey(key).toLowerCase()}/square`,
  };

  // ---- Version resolution ----------------------------------------------
  function readCachedVersion() {
    try {
      const raw = localStorage.getItem(VERSION_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.v !== 'string' || typeof parsed.ts !== 'number') return null;
      if (Date.now() - parsed.ts > VERSION_CACHE_TTL_MS) return null;
      return parsed.v;
    } catch (_) {
      return null;
    }
  }

  function writeCachedVersion(v) {
    try {
      localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify({ v, ts: Date.now() }));
    } catch (_) {
      /* ignore quota / disabled storage */
    }
  }

  async function resolveVersion() {
    const cached = readCachedVersion();
    if (cached) {
      state.version = cached;
      return;
    }
    try {
      const res = await fetch(VERSIONS_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      if (Array.isArray(list) && typeof list[0] === 'string') {
        state.version = list[0];
        writeCachedVersion(list[0]);
        return;
      }
      throw new Error('Unexpected versions payload');
    } catch (err) {
      // Silently fall back; the prototype must keep working offline / with CORS issues.
      console.warn('[ddragon] version fetch failed, using fallback', state.version, err);
    }
  }

  // ---- Image rewrite ---------------------------------------------------
  function attachErrorHandler(img) {
    if (img.dataset.ddErrorBound === '1') return;
    img.dataset.ddErrorBound = '1';
    img.addEventListener(
      'error',
      () => {
        // Keep the broken src out of the DOM and let CSS show the placeholder.
        img.classList.add('failed');
        img.removeAttribute('src');
      },
      { once: true }
    );
  }

  function setSrc(img, src) {
    if (!img || !src) return;
    attachErrorHandler(img);
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
  }

  function rewriteOne(img) {
    const ds = img.dataset;
    if (ds.ddChampion) return setSrc(img, urls.champion(ds.ddChampion));
    if (ds.ddItem) return setSrc(img, urls.item(ds.ddItem));
    if (ds.ddSpell) return setSrc(img, urls.spell(ds.ddSpell));
    if (ds.ddProfileIcon) return setSrc(img, urls.profileIcon(ds.ddProfileIcon));
    if (ds.ddRuneKeystone) return setSrc(img, urls.runeKeystone(ds.ddRuneKeystone));
    if (ds.ddSplash) return setSrc(img, urls.splash(ds.ddSplash));
    if (ds.ddChampionSquare) return setSrc(img, urls.championSquareCCDN(ds.ddChampionSquare));
    // Numeric-ID variants — async resolve via meta then rewrite.
    if (ds.ddChampionId) {
      loadMeta().then((m) => {
        const key = m.championIdToKey[ds.ddChampionId];
        if (key) setSrc(img, urls.champion(key));
        else img.classList.add('failed');
      });
      return;
    }
    if (ds.ddSpellId) {
      loadMeta().then((m) => {
        const key = m.spellIdToKey[ds.ddSpellId];
        if (key) setSrc(img, urls.spell(key));
        else img.classList.add('failed');
      });
      return;
    }
  }

  function rewriteAll(root) {
    const scope = root || document;
    const nodes = scope.querySelectorAll(
      '[data-dd-champion], [data-dd-champion-id], [data-dd-item], [data-dd-spell], [data-dd-spell-id], [data-dd-profile-icon], [data-dd-rune-keystone], [data-dd-splash], [data-dd-champion-square]'
    );
    nodes.forEach(rewriteOne);
  }

  // Watch for nodes added later (e.g., layout.js inserts header markup).
  function startMutationObserver() {
    if (!('MutationObserver' in window)) return;
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches && n.matches('img[data-dd-champion], img[data-dd-champion-id], img[data-dd-item], img[data-dd-spell], img[data-dd-spell-id], img[data-dd-profile-icon], img[data-dd-rune-keystone], img[data-dd-splash], img[data-dd-champion-square]')) {
            rewriteOne(n);
          }
          if (n.querySelectorAll) rewriteAll(n);
        });
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // ---- Boot ------------------------------------------------------------
  async function init() {
    await resolveVersion();
    state.ready = true;
    rewriteAll();
    startMutationObserver();
  }

  // Public API for callers that want to build URLs manually.
  window.DDragon = {
    get version() { return state.version; },
    get locale() { return state.locale; },
    get ready() { return state.ready; },
    urls,
    rewriteAll,
    meta: loadMeta,   // async: { championIdToKey, championKeyToName, spellIdToKey }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
