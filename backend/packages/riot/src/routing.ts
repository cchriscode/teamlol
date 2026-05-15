// Riot API routing helpers.
// Two routing layers:
//   - Platform route: per server (kr, na1, euw1, ...) — SUMMONER, LEAGUE, SPECTATOR, MASTERY, STATUS
//   - Regional route: continental (asia, americas, europe, sea) — ACCOUNT, MATCH

import { Region, RegionalRoute, REGION_TO_REGIONAL } from '@lol-tracker/shared';

export function regionalFor(region: Region): RegionalRoute {
  return REGION_TO_REGIONAL[region];
}

export function platformBase(region: Region): string {
  return `https://${region}.api.riotgames.com`;
}

export function regionalBase(region: Region): string {
  return `https://${REGION_TO_REGIONAL[region]}.api.riotgames.com`;
}
