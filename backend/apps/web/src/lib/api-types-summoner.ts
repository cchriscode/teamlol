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
  patch: string;
  queueId: number;
  gameCreation: number;
  gameDuration: number;
  bluewin: number | null;
  /** Stats for the requested player only. */
  self: {
    championKey: string;
    championId: number;
    lane: string;
    team: string;
    win: boolean;
    kills: number; deaths: number; assists: number;
    kp: number | null;
    cs: number;
    csPerMin: number | null;
    visionScore: number;
    dmgToChampPerMin: number;
    items: number[];
    spells: number[];
    runes?: unknown;
    aiScore: number | null;
    aiScoreLetter: string | null;
  };
  /** All 10 participants for the expand view. */
  participants: Array<{
    puuid: string;
    team: string;
    championKey: string;
    championId?: number;
    lane?: string;
    isSelf?: boolean;
    win?: boolean;
    nameKr?: string;
    gameName?: string;
    tagLine?: string;
    kills?: number; deaths?: number; assists?: number;
    kp?: number | null;
    cs?: number;
    csPerMin?: number | null;
    visionScore?: number;
    dmgToChampPerMin?: number;
    items?: number[];
    aiScore?: number | null;
    aiScoreLetter?: string | null;
  }>;
}
