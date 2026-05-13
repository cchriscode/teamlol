/**
 * app-config.js — Single source of truth for runtime config.
 *
 * Replaces the 11 duplicated `API_BASE` definitions across pages.
 * Load BEFORE any page-specific scripts.
 */
(function () {
  'use strict';

  function isLocal() {
    return location.hostname === 'localhost'
        || location.hostname === '127.0.0.1'
        || location.protocol === 'file:';
  }

  window.AppConfig = {
    /** Base URL for the API. Empty in production (same origin). */
    API_BASE: isLocal() ? 'http://localhost:3001' : '',

    /** User-selected region from header dropdown, defaulting to KR. */
    region: function () {
      return (localStorage.getItem('lol-tracker:region') || 'KR').toUpperCase();
    },

    /** Persist region (called from layout.js header). */
    setRegion: function (r) {
      if (!r) return;
      localStorage.setItem('lol-tracker:region', String(r).toUpperCase());
    },
  };
})();
