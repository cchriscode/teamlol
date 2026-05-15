// Lookup tables: championId ↔ champion key (e.g. 266 ↔ "Aatrox") and Korean
// names. Sourced from Data Dragon. Cached per request via React.cache so
// server components in the same render share one fetch.

import { cache } from 'react';
import { ddragon } from './ddragon';
import { getDdragonVersion } from './ddragon-version';

interface DdChampion {
  id: string;       // "Aatrox"
  key: string;      // "266" (string, integer-coerced when used)
  name: string;     // "아트록스"
  title: string;
  tags: string[];
}

export interface ChampionMeta {
  byId: Map<number, DdChampion>;     // numeric id → champion
  byKey: Map<string, DdChampion>;    // "Aatrox" → champion
}

export const getChampionMeta = cache(async (): Promise<ChampionMeta> => {
  const version = await getDdragonVersion();
  const url = `${ddragon.base}/cdn/${version}/data/ko_KR/champion.json`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) {
    return { byId: new Map(), byKey: new Map() };
  }
  const data = (await res.json()) as { data: Record<string, DdChampion> };
  const byId = new Map<number, DdChampion>();
  const byKey = new Map<string, DdChampion>();
  for (const c of Object.values(data.data)) {
    byId.set(Number(c.key), c);
    byKey.set(c.id, c);
  }
  return { byId, byKey };
});
