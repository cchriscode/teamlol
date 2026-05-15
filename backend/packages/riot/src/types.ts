// Subset of Riot API response types we care about. Not exhaustive — the worker
// stores rawDetail/rawTimeline JSONB so anything we miss can be re-extracted later.

import { Lane, ChampionId, Puuid, QueueType, RankedTier, Division } from '@lol-tracker/shared';

// ---- ACCOUNT-V1 -------------------------------------------------------
export interface RiotAccountDto {
  puuid: Puuid;
  gameName: string;
  tagLine: string;
}

// ---- SUMMONER-V4 ------------------------------------------------------
export interface SummonerDto {
  puuid: Puuid;
  profileIconId: number;
  revisionDate: number;
  summonerLevel: number;
}

// ---- LEAGUE-V4 --------------------------------------------------------
export interface LeagueEntryDto {
  puuid: Puuid;
  queueType: QueueType;
  tier: RankedTier;
  rank: Division | '';
  leaguePoints: number;
  wins: number;
  losses: number;
  veteran: boolean;
  inactive: boolean;
  freshBlood: boolean;
  hotStreak: boolean;
}

export interface LeagueListDto {
  leagueId: string;
  tier: RankedTier;
  queue: QueueType;
  name: string;
  entries: Array<LeagueEntryDto & { puuid: Puuid; summonerId: string }>;
}

// ---- MATCH-V5 ---------------------------------------------------------
// Trimmed shape — the full DTO is huge.
export interface MatchDto {
  metadata: {
    matchId: string;
    dataVersion: string;
    participants: Puuid[];
  };
  info: {
    gameId: number;
    gameCreation: number;
    gameDuration: number;       // seconds
    gameStartTimestamp: number;
    gameEndTimestamp?: number;
    gameVersion: string;
    mapId: number;
    queueId: number;
    platformId: string;
    teams: TeamDto[];
    participants: ParticipantDto[];
  };
}

export interface TeamDto {
  teamId: 100 | 200;
  win: boolean;
  bans: Array<{ championId: number; pickTurn: number }>;
  objectives: Record<string, { first: boolean; kills: number }>;
}

export interface ParticipantDto {
  puuid: Puuid;
  participantId: number;
  teamId: 100 | 200;
  championId: ChampionId;
  championName: string;
  teamPosition: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | '';
  individualPosition: string;
  win: boolean;
  // KDA
  kills: number;
  deaths: number;
  assists: number;
  // Farm
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  // Economy
  goldEarned: number;
  goldSpent: number;
  // Damage
  totalDamageDealtToChampions: number;
  damageDealtToObjectives: number;
  damageDealtToBuildings: number;
  totalDamageTaken: number;
  damageSelfMitigated: number;
  // Vision
  visionScore: number;
  wardsPlaced: number;
  wardsKilled: number;
  visionWardsBoughtInGame: number;
  // Death timing
  totalTimeSpentDead: number;
  longestTimeSpentLiving: number;
  // Items
  item0: number; item1: number; item2: number;
  item3: number; item4: number; item5: number; item6: number;
  // Spells
  summoner1Id: number;
  summoner2Id: number;
  // Bonuses
  largestMultiKill: number;
  doubleKills: number;
  tripleKills: number;
  quadraKills: number;
  pentaKills: number;
  soloKills?: number;
  // Runes
  perks: unknown;
  // Lots more — stored verbatim in JSONB
}

// ---- MATCH-V5 timeline ------------------------------------------------
export interface MatchTimelineDto {
  metadata: { matchId: string; dataVersion: string; participants: Puuid[] };
  info: {
    frameInterval: number;
    frames: TimelineFrame[];
  };
}

export interface TimelineFrame {
  timestamp: number;
  participantFrames: Record<string, ParticipantFrame>;
  events: TimelineEvent[];
}

export interface ParticipantFrame {
  participantId: number;
  championStats: Record<string, number>;
  damageStats: Record<string, number>;
  totalGold: number;
  currentGold: number;
  goldPerSecond: number;
  level: number;
  xp: number;
  minionsKilled: number;
  jungleMinionsKilled: number;
  position: { x: number; y: number };
}

export type TimelineEvent =
  | { type: 'CHAMPION_KILL'; timestamp: number; killerId: number; victimId: number; assistingParticipantIds?: number[]; position?: { x: number; y: number } }
  | { type: 'BUILDING_KILL'; timestamp: number; killerId: number; buildingType: string; towerType?: string; laneType?: string }
  | { type: 'ELITE_MONSTER_KILL'; timestamp: number; killerId: number; monsterType: string; monsterSubType?: string; killerTeamId: number }
  | { type: 'ITEM_PURCHASED'; timestamp: number; participantId: number; itemId: number }
  | { type: 'ITEM_SOLD'; timestamp: number; participantId: number; itemId: number }
  | { type: 'ITEM_DESTROYED'; timestamp: number; participantId: number; itemId: number }
  | { type: 'SKILL_LEVEL_UP'; timestamp: number; participantId: number; skillSlot: number; levelUpType: string }
  | { type: 'WARD_PLACED'; timestamp: number; creatorId: number; wardType: string }
  | { type: 'WARD_KILL'; timestamp: number; killerId: number; wardType: string }
  | { type: 'LEVEL_UP'; timestamp: number; participantId: number; level: number }
  | { type: string; timestamp: number; [k: string]: unknown };

// ---- SPECTATOR-V5 -----------------------------------------------------
export interface CurrentGameInfoDto {
  gameId: number;
  gameType: string;
  gameStartTime: number;
  gameLength: number;
  gameQueueConfigId: number;
  mapId: number;
  participants: Array<{
    puuid: Puuid;
    teamId: 100 | 200;
    championId: number;
    spell1Id: number;
    spell2Id: number;
    perks?: unknown;
  }>;
  bannedChampions: Array<{
    championId: number;
    teamId: 100 | 200;
    pickTurn: number;
  }>;
  observers: { encryptionKey: string };
  platformId: string;
}

// ---- CHAMPION-MASTERY-V4 ----------------------------------------------
export interface ChampionMasteryDto {
  puuid: Puuid;
  championId: number;
  championLevel: number;
  championPoints: number;
  lastPlayTime: number;
  championPointsSinceLastLevel: number;
  championPointsUntilNextLevel: number;
  chestGranted: boolean;
  tokensEarned: number;
}

// ---- LOL-STATUS-V4 ----------------------------------------------------
export interface PlatformDataDto {
  id: string;
  name: string;
  locales: string[];
  maintenances: unknown[];
  incidents: unknown[];
}

// ---- Position helpers -------------------------------------------------
export function teamPositionToLane(p: ParticipantDto['teamPosition']): Lane | null {
  switch (p) {
    case 'TOP': return 'top';
    case 'JUNGLE': return 'jungle';
    case 'MIDDLE': return 'mid';
    case 'BOTTOM': return 'adc';
    case 'UTILITY': return 'support';
    default: return null;
  }
}

export function teamId(t: 100 | 200): 'blue' | 'red' {
  return t === 100 ? 'blue' : 'red';
}
