// Data Dragon URL builders. Mirrors prototype/ddragon.js but as a typed helper
// without DOM rewriting (React components consume URLs directly).

const FALLBACK_VERSION = '16.10.1';
const FALLBACK_LOCALE = 'ko_KR';
const BASE = 'https://ddragon.leagueoflegends.com';
const CCDN_BASE = 'https://cdn.communitydragon.org/latest';

const CHAMPION_KEY_ALIASES: Record<string, string> = {
  // MATCH-V5 returns "FiddleSticks" but ddragon serves at "Fiddlesticks".
  FiddleSticks: 'Fiddlesticks',
};

export function canonicalChampionKey(key: string): string {
  return CHAMPION_KEY_ALIASES[key] ?? key;
}

export interface DdragonOpts {
  version?: string;
  locale?: string;
}

export const ddragon = {
  base: BASE,
  fallbackVersion: FALLBACK_VERSION,
  fallbackLocale: FALLBACK_LOCALE,

  championIcon(key: string, version = FALLBACK_VERSION): string {
    return `${BASE}/cdn/${version}/img/champion/${encodeURIComponent(canonicalChampionKey(key))}.png`;
  },
  itemIcon(id: number | string, version = FALLBACK_VERSION): string {
    return `${BASE}/cdn/${version}/img/item/${id}.png`;
  },
  spellIcon(key: string, version = FALLBACK_VERSION): string {
    return `${BASE}/cdn/${version}/img/spell/${encodeURIComponent(key)}.png`;
  },
  profileIcon(id: number | string, version = FALLBACK_VERSION): string {
    return `${BASE}/cdn/${version}/img/profileicon/${id}.png`;
  },
  // Splash and rune images are NOT versioned.
  championSplash(key: string): string {
    return `${BASE}/cdn/img/champion/splash/${encodeURIComponent(canonicalChampionKey(key))}_0.jpg`;
  },
  runeIcon(path: string): string {
    // path is the static_runes.icon_path value (e.g. "perk-images/Styles/Domination/Electrocute/Electrocute.png").
    return `${BASE}/cdn/img/${path}`;
  },
  // Secondary style tree icon (the small tree-color emblem).
  runeStyleIcon(styleId: number): string {
    // Style IDs: 8000 Precision, 8100 Domination, 8200 Sorcery, 8300 Inspiration, 8400 Resolve.
    const slug = ({ 8000: '7201_Precision', 8100: '7200_Domination', 8200: '7202_Sorcery',
                    8300: '7203_Whimsy', 8400: '7204_Resolve' } as Record<number, string>)[styleId];
    if (!slug) return `${BASE}/cdn/img/perk-images/Styles/RunesIcon.png`;
    return `${BASE}/cdn/img/perk-images/Styles/${slug}.png`;
  },
  // Community Dragon — square champion tile.
  championSquareCCDN(key: string): string {
    return `${CCDN_BASE}/champion/${canonicalChampionKey(key).toLowerCase()}/square`;
  },
};
