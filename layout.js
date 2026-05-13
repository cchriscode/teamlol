/**
 * layout.js — Header/footer template injection.
 * Single source of truth for site chrome across every prototype page.
 *
 * Usage in HTML:
 *   <div data-slot="header" data-active="champions"></div>
 *   <main>...</main>
 *   <div data-slot="footer"></div>
 *
 * `data-active` values: search | champions | leaderboard | multi-search | (none)
 * `data-search-placeholder` (optional): override the header search placeholder.
 */
(function () {
  'use strict';

  // ---- Nav configuration (single source of truth) ----------------------
  const NAV_ITEMS = [
    { key: 'search', href: 'index.html', label: '소환사검색' },
    { key: 'champions', href: 'champions.html', label: '챔피언' },
    { key: 'leaderboard', href: 'leaderboard.html', label: '랭킹' },
    { key: 'multi-search', href: 'multi-search.html', label: '멀티서치' },
    { key: 'pick-recommend', href: 'pick-recommend.html', label: '픽 추천', badge: 'BETA' },
  ];

  const REGIONS = ['KR', 'NA', 'EUW', 'EUNE', 'JP', 'BR', 'OCE', 'TR', 'RU', 'VN', 'TW'];
  const DEFAULT_REGION = 'KR';
  const REGION_STORAGE_KEY = 'lol-tracker:region';

  const FOOTER_DISCLAIMER =
    'LoL Tracker is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.';
  const FOOTER_LINKS = [
    { href: 'about.html', label: '서비스 소개' },
    { href: 'terms.html', label: '이용약관' },
    { href: 'privacy.html', label: '개인정보처리방침' },
    { href: 'mailto:contact@example.com', label: '문의' },
  ];

  // ---- Helpers ----------------------------------------------------------
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function readStoredRegion() {
    try {
      const v = localStorage.getItem(REGION_STORAGE_KEY);
      if (v && REGIONS.includes(v)) return v;
    } catch (_) {}
    return DEFAULT_REGION;
  }

  function writeStoredRegion(v) {
    try { localStorage.setItem(REGION_STORAGE_KEY, v); } catch (_) {}
  }

  // ---- Template builders -----------------------------------------------
  function navLinksHtml(activeKey) {
    return NAV_ITEMS.map(item => {
      const active = item.key === activeKey ? ' active' : '';
      const ariaCurrent = item.key === activeKey ? ' aria-current="page"' : '';
      const badge = item.badge
        ? ` <span class="nav-badge">${escapeHtml(item.badge)}</span>`
        : '';
      return `<a href="${item.href}" class="${active.trim()}"${ariaCurrent}>${escapeHtml(item.label)}${badge}</a>`;
    }).join('');
  }

  function regionOptionsHtml(current) {
    return REGIONS.map(r => `<option value="${r}"${r === current ? ' selected' : ''}>${r}</option>`).join('');
  }

  function headerHtml({ activeKey, searchPlaceholder, showHeaderSearch }) {
    const region = readStoredRegion();
    const placeholder = escapeHtml(searchPlaceholder || '소환사명#태그');
    const searchBlock = showHeaderSearch ? `
      <form class="header-search" role="search" data-component="header-search">
        <svg class="header-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/>
        </svg>
        <label class="sr-only" for="header-search-input">소환사 검색</label>
        <input id="header-search-input" type="text" placeholder="${placeholder}" autocomplete="off">
      </form>` : '';

    return `
<header class="header">
  <div class="header-inner">
    <div class="header-brand">
      <a href="index.html" class="logo" aria-label="LoL Tracker 홈">LoL Tracker</a>
      <nav class="nav-links" aria-label="주요 메뉴">${navLinksHtml(activeKey)}</nav>
    </div>
    ${searchBlock}
    <div class="header-tools">
      <label class="sr-only" for="header-region">서버 선택</label>
      <select id="header-region" class="region-select" data-component="region-select">${regionOptionsHtml(region)}</select>
      <button class="nav-burger" type="button" aria-label="메뉴 열기" aria-expanded="false" data-component="nav-burger">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12"/>
        </svg>
      </button>
    </div>
  </div>
  <nav class="nav-mobile" hidden aria-label="모바일 메뉴">${navLinksHtml(activeKey)}</nav>
</header>`;
  }

  function footerHtml() {
    const links = FOOTER_LINKS.map(l => `<a href="${l.href}">${escapeHtml(l.label)}</a>`).join('');
    return `
<footer class="footer">
  <div class="footer-inner">
    <p>${escapeHtml(FOOTER_DISCLAIMER)}</p>
    <p>© 2026 LoL Tracker</p>
    <div class="footer-links">${links}</div>
  </div>
</footer>`;
  }

  // ---- Behavior wiring -------------------------------------------------
  function wireRegion(scope) {
    const select = scope.querySelector('[data-component="region-select"]');
    if (!select) return;
    select.addEventListener('change', (e) => writeStoredRegion(e.target.value));
  }

  function wireBurger(scope) {
    const burger = scope.querySelector('[data-component="nav-burger"]');
    const mobile = scope.querySelector('.nav-mobile');
    if (!burger || !mobile) return;
    burger.addEventListener('click', () => {
      const open = !mobile.hidden;
      mobile.hidden = open;
      burger.setAttribute('aria-expanded', String(!open));
    });
  }

  function wireSearch(scope) {
    const form = scope.querySelector('[data-component="header-search"]');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input');
      const value = (input && input.value || '').trim();
      if (!value) return;
      const [name, tag] = value.split('#');
      if (!name || !tag) {
        input.setCustomValidity('형식: 이름#KR1');
        input.reportValidity();
        setTimeout(() => input.setCustomValidity(''), 1500);
        return;
      }
      const region = readStoredRegion().toLowerCase();
      // Keep prototype routing simple: open the demo summoner page.
      window.location.href = `summoner.html?region=${encodeURIComponent(region)}&name=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`;
    });
  }

  function injectMobileStyles() {
    if (document.getElementById('layout-inline-styles')) return;
    const style = document.createElement('style');
    style.id = 'layout-inline-styles';
    style.textContent = `
      .nav-mobile { display: none; }
      @media (max-width: 768px) {
        .nav-mobile {
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          border-bottom: 1px solid var(--border-subtle);
          padding: var(--space-2) var(--content-padding-x);
          gap: 2px;
        }
        .nav-mobile a {
          padding: 10px var(--space-2);
          font-size: 13px;
          color: var(--text-secondary);
          border-radius: var(--radius-md);
        }
        .nav-mobile a.active { color: var(--text-primary); background: var(--bg-elevated); font-weight: 500; }
      }
    `;
    document.head.appendChild(style);
  }

  // ---- Public API ------------------------------------------------------
  function injectHeader(slotEl) {
    const activeKey = slotEl.dataset.active || '';
    const searchPlaceholder = slotEl.dataset.searchPlaceholder || '';
    const showHeaderSearch = slotEl.dataset.showSearch !== 'false';
    slotEl.outerHTML = headerHtml({ activeKey, searchPlaceholder, showHeaderSearch });
    const inserted = document.querySelector('.header');
    if (inserted) {
      wireRegion(inserted);
      wireBurger(inserted.parentElement || document);
      wireSearch(inserted);
    }
  }

  function injectFooter(slotEl) {
    slotEl.outerHTML = footerHtml();
  }

  // Carry the current page's region/name/tag URL params into all .tabs links
  // so users can navigate the per-summoner tab nav without losing context.
  function wireTabsCarryParams() {
    const params = new URL(location.href).searchParams;
    const region = params.get('region');
    const name = params.get('name');
    const tag = params.get('tag');
    if (!region || !name || !tag) return;
    const qs = '?region=' + encodeURIComponent(region)
             + '&name=' + encodeURIComponent(name)
             + '&tag=' + encodeURIComponent(tag);
    document.querySelectorAll('.tabs .tab').forEach(function (tab) {
      var href = tab.getAttribute('href');
      if (!href || href.indexOf('?') !== -1) return;
      tab.setAttribute('href', href + qs);
    });
  }

  function init() {
    injectMobileStyles();
    document.querySelectorAll('[data-slot="header"]').forEach(injectHeader);
    document.querySelectorAll('[data-slot="footer"]').forEach(injectFooter);
    wireTabsCarryParams();
  }

  window.Layout = { init, headerHtml, footerHtml, NAV_ITEMS, REGIONS };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
