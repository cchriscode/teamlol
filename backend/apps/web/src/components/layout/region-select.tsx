'use client';

import { useEffect, useState } from 'react';
import { REGIONS, DEFAULT_REGION, REGION_STORAGE_KEY, type Region } from './nav-config';

export function RegionSelect() {
  // Default render = DEFAULT_REGION so SSR and first client render match.
  // After hydration, swap in the localStorage value if any.
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(REGION_STORAGE_KEY) as Region | null;
      if (stored && REGIONS.includes(stored as Region)) setRegion(stored as Region);
    } catch {}
  }, []);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as Region;
    setRegion(next);
    try { localStorage.setItem(REGION_STORAGE_KEY, next); } catch {}
  };

  return (
    <>
      <label className="sr-only" htmlFor="header-region">서버 선택</label>
      <select id="header-region" className="region-select" value={region} onChange={onChange}>
        {REGIONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </>
  );
}
