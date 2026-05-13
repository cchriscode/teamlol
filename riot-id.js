/**
 * riot-id.js — Parsing and URL building for Riot IDs (name#tag).
 *
 * Replaces parseRiotId implementations in:
 *   layout.js, index.html, error-404.html, multi-search.html
 *
 * Riot ID rules:
 *   - gameName: up to 16 chars, can contain spaces and most chars
 *   - tagLine: 3~5 chars (alphanumeric usually)
 *   - separator is '#' (single)
 *   - gameName cannot contain '#' so split-on-last-'#' is unambiguous
 */
(function () {
  'use strict';

  /** Parse "Hide on bush#KR1" → { gameName, tagLine } | null. */
  function parseRiotId(input) {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    const hash = trimmed.lastIndexOf('#');
    if (hash <= 0 || hash === trimmed.length - 1) return null;
    const gameName = trimmed.slice(0, hash).trim();
    const tagLine = trimmed.slice(hash + 1).trim();
    if (!gameName || !tagLine) return null;
    return { gameName: gameName, tagLine: tagLine };
  }

  function formatRiotId(id) {
    if (!id || !id.gameName || !id.tagLine) return '';
    return id.gameName + '#' + id.tagLine;
  }

  /** Build a /summoner.html link. */
  function summonerHref(opts) {
    const region = (opts.region || (window.AppConfig && window.AppConfig.region()) || 'KR').toLowerCase();
    return 'summoner.html?region=' + encodeURIComponent(region)
         + '&name=' + encodeURIComponent(opts.gameName || opts.name)
         + '&tag=' + encodeURIComponent(opts.tagLine || opts.tag);
  }

  window.RiotId = {
    parse: parseRiotId,
    format: formatRiotId,
    summonerHref: summonerHref,
  };
})();
