/**
 * i18n.js — Korean labels for game enums.
 *
 * Replaces the 8 copies of laneKr, 4 copies of tierKr, scattered queueKr/tierClass.
 */
(function () {
  'use strict';

  const LANE_KR = {
    top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿',
  };

  const TIER_KR = {
    IRON: '아이언', BRONZE: '브론즈', SILVER: '실버', GOLD: '골드', PLATINUM: '플래티넘',
    EMERALD: '에메랄드', DIAMOND: '다이아몬드', MASTER: '마스터',
    GRANDMASTER: '그랜드마스터', CHALLENGER: '챌린저',
  };

  const QUEUE_KR = {
    420: '솔로랭크', 440: '자유랭크', 450: '칼바람',
    400: '일반', 430: '일반', 700: '격전', 900: 'URF',
  };

  const ARCHETYPE_KR = {
    engage: '이니시형', poke: '포크형', pick: '픽오프형',
    protect: '보호형', sustain: '지속형', onhit: '평타형',
    killlane: '킬라인',
  };

  function tierClass(t) {
    if (!t) return 'tier-iron';
    return 'tier-' + String(t).toLowerCase();
  }

  /** Escape HTML entities (replace 4 inline copies). */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  window.I18n = {
    laneKr: function (l) { return LANE_KR[l] || l || ''; },
    tierKr: function (t) { return TIER_KR[t] || t || ''; },
    queueKr: function (qid) { return QUEUE_KR[qid] || ('큐 ' + qid); },
    archetypeKr: function (a) { return ARCHETYPE_KR[a] || a || ''; },
    tierClass: tierClass,
    escapeHtml: escapeHtml,
    LANE_KR: LANE_KR,
    TIER_KR: TIER_KR,
  };
})();
