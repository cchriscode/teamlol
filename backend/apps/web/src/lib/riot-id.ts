// Riot ID is "gameName#tagLine". URL-friendly slug: "gameName-tagLine".
// Split at the LAST dash to allow names containing dashes.

export interface RiotId {
  gameName: string;
  tagLine: string;
}

export function slugFromRiotId(id: RiotId): string {
  return `${id.gameName}-${id.tagLine}`;
}

export function parseRiotIdSlug(slug: string): RiotId | null {
  const decoded = decodeURIComponent(slug);
  const idx = decoded.lastIndexOf('-');
  if (idx < 1 || idx === decoded.length - 1) return null;
  return {
    gameName: decoded.slice(0, idx),
    tagLine: decoded.slice(idx + 1),
  };
}

export function formatRiotId(id: RiotId): string {
  return `${id.gameName}#${id.tagLine}`;
}
