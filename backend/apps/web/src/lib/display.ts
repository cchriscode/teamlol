// Shared display helpers — tier/lane/time formatting + anonymous name lookup.
// Consolidated from 4+ duplicate definitions across summoner/match/champion pages.

const TIER_KR: Record<string, string> = {
  IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
  PLATINUM: 'Platinum', EMERALD: 'Emerald', DIAMOND: 'Diamond',
  MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
};
export function tierKr(tier: string): string {
  return TIER_KR[tier] ?? tier;
}
export function tierClass(tier: string): string {
  return 'tier-' + tier.toLowerCase();
}

const LANE_KR: Record<string, string> = {
  top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿',
};
export function laneKr(l: string): string {
  return LANE_KR[l] ?? l;
}

export function timeAgo(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

// Render-time name lookup honouring the anonymous toggle (still shows self).
export function displayName(
  p: { puuid: string; nameKr?: string; gameName?: string },
  selfPuuid: string,
  anonymous: boolean,
): string {
  if (anonymous && p.puuid !== selfPuuid) return '소환사 ' + p.puuid.slice(0, 4).toUpperCase();
  return p.nameKr ?? p.gameName ?? p.puuid.slice(0, 6);
}
