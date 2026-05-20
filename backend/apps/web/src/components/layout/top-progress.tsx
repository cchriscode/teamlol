'use client';

// Thin colored progress bar at the top of the viewport (op.gg / nprogress
// style) so users know a navigation is in flight rather than the page
// being frozen.
//
// Triggers:
//   1. Anchor-click listener — fires immediately on <a href> clicks
//   2. history.pushState / replaceState patch — catches router.push()
//      from autocomplete suggestions, form submits, and any other
//      programmatic navigation
//   3. popstate — back/forward buttons
//
// Completion:
//   - usePathname / useSearchParams effect snaps to 100% then fades when
//     the new route mounts.
//
// Pure CSS animation — no nprogress dependency, no rAF loop.

import { useEffect, useRef, useState, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Module-level flag so the history patch only runs once across mounts.
let historyPatched = false;
const subscribers = new Set<() => void>();

function notifyNavStart() {
  for (const fn of subscribers) {
    try { fn(); } catch { /* ignore */ }
  }
}

function patchHistoryOnce() {
  if (historyPatched || typeof window === 'undefined') return;
  historyPatched = true;
  const origPush = window.history.pushState.bind(window.history);
  const origReplace = window.history.replaceState.bind(window.history);
  window.history.pushState = function (...args: Parameters<typeof origPush>) {
    notifyNavStart();
    return origPush(...args);
  };
  window.history.replaceState = function (...args: Parameters<typeof origReplace>) {
    notifyNavStart();
    return origReplace(...args);
  };
  window.addEventListener('popstate', notifyNavStart);
}

type Phase = 'idle' | 'loading' | 'done';

function TopProgressInner() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [phase, setPhase] = useState<Phase>('idle');
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKey = useRef<string>(`${pathname}?${search?.toString() ?? ''}`);

  // Route change → navigation finished. Snap to 100% then fade.
  useEffect(() => {
    const nextKey = `${pathname}?${search?.toString() ?? ''}`;
    if (nextKey === lastKey.current) return;
    lastKey.current = nextKey;
    if (phase === 'loading') {
      setPhase('done');
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      fadeTimer.current = setTimeout(() => setPhase('idle'), 380);
    }
    // If a route change happens without a click (programmatic), we just
    // skip — no bar to show is better than a confusing flash.
  }, [pathname, search, phase]);

  // Anchor click + programmatic navigation (router.push from autocomplete,
  // form submits, etc.). The history patch is a one-time module-level
  // monkeypatch; we just subscribe to its notifications here.
  useEffect(() => {
    const onStart = () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      setPhase('loading');
    };
    patchHistoryOnce();
    subscribers.add(onStart);

    const clickHandler = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      const link = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link) return;
      if (link.target && link.target !== '_self') return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const cur = `${window.location.pathname}?${window.location.search}`;
      const nxt = `${url.pathname}?${url.search}`;
      if (cur === nxt) return;
      onStart();
    };
    document.addEventListener('click', clickHandler, true);
    return () => {
      subscribers.delete(onStart);
      document.removeEventListener('click', clickHandler, true);
    };
  }, []);

  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);

  return (
    <div className={`top-progress phase-${phase}`} aria-hidden="true">
      <div className="top-progress-bar" />
    </div>
  );
}

// useSearchParams must be wrapped in Suspense per Next.js 13+ rules.
export function TopProgress() {
  return (
    <Suspense fallback={null}>
      <TopProgressInner />
    </Suspense>
  );
}
