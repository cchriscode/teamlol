'use client';

import { useEffect, useState } from 'react';

export interface SuggestMatch {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: string;
  tier?: string | null;
  rank?: string | null;
  lp?: number | null;
}

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

// Debounced fetch of /api/summoner/suggest. Returns [] for queries shorter
// than 2 chars or containing '#' (user is typing a full Riot ID).
export function useSearchSuggest(query: string, region = 'kr', delayMs = 200) {
  const [matches, setMatches] = useState<SuggestMatch[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q.includes('#')) {
      setMatches([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const url = `${BASE}/api/summoner/suggest?q=${encodeURIComponent(q)}&region=${encodeURIComponent(region)}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) { setMatches([]); return; }
        const body = await res.json();
        setMatches(Array.isArray(body.matches) ? body.matches : []);
      } catch {
        // ignore (likely abort)
      } finally {
        setLoading(false);
      }
    }, delayMs);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, region, delayMs]);

  return { matches, loading };
}
