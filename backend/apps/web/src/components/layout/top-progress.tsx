'use client';

// Thin colored progress bar at the top of the viewport (op.gg / nprogress
// style) so users know a navigation is in flight rather than the page
// being frozen.
//
// How it works:
//   - Anchor-click listener flips state to "loading" — bar fades in and
//     animates 0 → 70% width over several seconds (curve suggests progress
//     without ever reaching 100%, which is dishonest until done)
//   - usePathname / useSearchParams effect fires after the new route
//     mounts → snap to 100% briefly, then fade out
//   - Ignores cross-origin links, target=_blank, and modifier-key clicks
//
// Pure CSS animation — no nprogress dependency, no rAF loop.

import { useEffect, useRef, useState, Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

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

  // Anchor click → start loading. Captures bubbling clicks so the bar
  // appears immediately, before the browser starts the navigation.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
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
      if (cur === nxt) return;     // same page = no nav
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
      setPhase('loading');
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
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
