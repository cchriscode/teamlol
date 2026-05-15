// Summoner-related API response types. Keep in sync with apps/api/src/routes/summoner.ts.

export interface AccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
  region: string;
}

export interface SummonerProfileDto {
  profileIconId: number;
  summonerLevel: number;
  refreshedAt: string;
}

export interface LeagueEntryDto {
  queueType: string;       // "RANKED_SOLO_5x5" | "RANKED_FLEX_SR"
  tier: string;            // "DIAMOND"
  rank: string;            // "II"
  leaguePoints: number;
  wins: number;
  losses: number;
  winrate: number;
}

export interface SummonerSearchResponse {
  cold: boolean;
  account: AccountDto;
  summoner: SummonerProfileDto | null;
  leagueEntries: LeagueEntryDto[];
  matchesAvailable: number;
  deepCollectTriggered: boolean;
}

export interface MatchListResponse {
  puuid: string;
  count: number;
  matches: MatchListItem[];
}

export interface MatchListItem {
  matchId: string;
  region: string;
  patch: string;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  win: boolean;
  championId: number;
  championKey: string;
  lane: string;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  goldPerMin: number;
  visionScore: number;
  items: number[];
  spells?: number[];
  runes?: unknown;
  participants: Array<{
    puuid: string;
    team: string;
    championKey: string;
    nameKr?: string;
    gameName?: string;
    tagLine?: string;
  }>;
}
