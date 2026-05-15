// Resolves the current Data Dragon patch version. Cached per-process via
// React.cache so repeated calls in one render share the same in-flight promise.

import { cache } from 'react';
import { ddragon } from './ddragon';

const VERSIONS_URL = `${ddragon.base}/api/versions.json`;

export const getDdragonVersion = cache(async (): Promise<string> => {
  try {
    const res = await fetch(VERSIONS_URL, {
      // Re-validate hourly. Patch ships rarely; minor variance fine.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return ddragon.fallbackVersion;
    const list = (await res.json()) as string[];
    return list[0] ?? ddragon.fallbackVersion;
  } catch {
    return ddragon.fallbackVersion;
  }
});
