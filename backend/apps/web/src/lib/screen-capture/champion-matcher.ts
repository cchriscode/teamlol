// Match a cropped image region against the entire champion roster via pHash.
//
// On first use, downloads + hashes every ddragon champion icon (170+) and
// caches the hashes in IndexedDB. Subsequent matches are pure in-memory
// lookups against the cached table.
//
// Returns top-K candidates with Hamming distance. Caller decides what
// threshold counts as a confident match; empirically <12 = high confidence,
// 12-20 = maybe, >20 = no match.

import { computePHash, hashDistance, PHash } from './phash.js';

const CACHE_KEY = 'tlol_champ_phashes_v1';
const IDB_NAME = 'teamlol-capture';
const IDB_STORE = 'champ-phashes';

interface ChampionHash {
  key: string;       // DDragon key like "Aatrox"
  hi: number;
  lo: number;
}

let cache: ChampionHash[] | null = null;

export interface MatchResult {
  championKey: string;
  distance: number;
}

export async function ensureHashesLoaded(
  championKeys: string[],
  ddragonVersion: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (cache && cache.length >= championKeys.length) return;

  const existing = await readFromIdb();
  if (existing && existing.length >= championKeys.length) {
    cache = existing;
    return;
  }

  // Need to (re)compute. Fetch icons in small batches; CORS-enabled by ddragon.
  const newCache: ChampionHash[] = [];
  let done = 0;
  for (const key of championKeys) {
    try {
      const img = await loadImage(`https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${key}.png`);
      const ph = computePHash(img);
      newCache.push({ key, hi: ph.hi, lo: ph.lo });
    } catch {
      // Skip missing icons — they'll just never match.
    }
    done += 1;
    if (onProgress && done % 5 === 0) onProgress(done, championKeys.length);
  }
  if (onProgress) onProgress(done, championKeys.length);

  cache = newCache;
  await writeToIdb(newCache);
}

export function matchChampion(canvas: HTMLCanvasElement, topK = 3): MatchResult[] {
  if (!cache) return [];
  const queryHash = computePHash(canvas);
  const results: MatchResult[] = [];
  for (const ref of cache) {
    const d = hashDistance(queryHash, { hi: ref.hi, lo: ref.lo });
    results.push({ championKey: ref.key, distance: d });
  }
  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, topK);
}

// ---- helpers ------------------------------------------------------------

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readFromIdb(): Promise<ChampionHash[] | null> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const req = store.get(CACHE_KEY);
      req.onsuccess = () => resolve((req.result as ChampionHash[] | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeToIdb(rows: ChampionHash[]): Promise<void> {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(rows, CACHE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    return;
  }
}
