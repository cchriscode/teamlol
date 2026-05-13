/**
 * api-client.js — Centralized API calls.
 *
 * - One AbortController per logical screen (so a new fetch cancels the prior one)
 * - Honors Retry-After on 429 (one retry)
 * - Returns null on network/HTTP failure (callers fall back to demo data)
 * - JSON body parsing with safe fallback
 *
 * Replaces ad-hoc fetch wrappers in 11 pages.
 */
(function () {
  'use strict';

  function base() {
    return (window.AppConfig && window.AppConfig.API_BASE) || '';
  }

  async function request(path, opts) {
    opts = opts || {};
    const url = base() + path;
    const init = {
      method: opts.method || 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: opts.signal,
    };
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      return { ok: false, status: 0, error: 'network', body: null };
    }
    // 429: honor Retry-After once.
    if (res.status === 429 && !opts._retried) {
      const ra = Number(res.headers.get('retry-after'));
      const waitMs = isFinite(ra) && ra > 0 ? ra * 1000 : 1000;
      await new Promise(function (r) { setTimeout(r, Math.min(waitMs, 5000)); });
      return request(path, Object.assign({}, opts, { _retried: true }));
    }
    let body = null;
    try { body = await res.json(); } catch (_) { /* non-json */ }
    return { ok: res.ok, status: res.status, body: body, error: res.ok ? null : (body && body.error) || ('HTTP ' + res.status) };
  }

  /** Manage a single in-flight controller per key (e.g. one per page). */
  const inFlight = new Map();
  function abortKey(key) {
    const ctl = inFlight.get(key);
    if (ctl) ctl.abort();
    inFlight.delete(key);
  }
  function newController(key) {
    abortKey(key);
    const ctl = new AbortController();
    inFlight.set(key, ctl);
    return ctl;
  }

  // ---- Endpoint shortcuts -------------------------------------------------
  const Api = {
    request: request,
    abort: abortKey,
    controller: newController,

    summoner: function (region, riotId, signal) {
      return request('/api/summoner/' + encodeURIComponent(region) + '/' + encodeURIComponent(riotId), { signal: signal });
    },
    matches: function (puuid, count, signal) {
      return request('/api/summoner/' + encodeURIComponent(puuid) + '/matches?count=' + (count || 20), { signal: signal });
    },
    refresh: function (puuid) {
      return request('/api/summoner/' + encodeURIComponent(puuid) + '/refresh', { method: 'POST' });
    },
    championsTier: function (params, signal) {
      const q = new URLSearchParams();
      if (params && params.lane && params.lane !== 'all') q.set('lane', params.lane);
      if (params && params.bracket) q.set('bracket', params.bracket);
      if (params && params.patch) q.set('patch', params.patch);
      const qs = q.toString();
      return request('/api/champions/tier' + (qs ? '?' + qs : ''), { signal: signal });
    },
    pickRecommendData: function (params, signal) {
      const q = new URLSearchParams();
      if (params && params.bracket) q.set('bracket', params.bracket);
      if (params && params.patch) q.set('patch', params.patch);
      const qs = q.toString();
      return request('/api/pick-recommend/data' + (qs ? '?' + qs : ''), { signal: signal });
    },
    leaderboard: function (region, params, signal) {
      const q = new URLSearchParams();
      if (params && params.queue) q.set('queue', params.queue);
      if (params && params.tier) q.set('tier', params.tier);
      const qs = q.toString();
      return request('/api/leaderboard/' + encodeURIComponent(region) + (qs ? '?' + qs : ''), { signal: signal });
    },
    live: function (region, puuid, signal) {
      return request('/api/live/' + encodeURIComponent(region) + '/' + encodeURIComponent(puuid), { signal: signal });
    },
    match: function (matchId, signal) {
      return request('/api/match/' + encodeURIComponent(matchId), { signal: signal });
    },
  };

  window.Api = Api;
})();
