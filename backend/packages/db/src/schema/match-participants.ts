import { pgTable, text, integer, real, boolean, timestamp, jsonb, primaryKey, index } from 'drizzle-orm/pg-core';

// One row per (match × player). 10 rows per match.
// Heavily denormalized for fast aggregation; raw participant blob kept for re-extract.
// ai_score_cached is precomputed by W2 at ingest time (spec §4 decision).
export const matchParticipants = pgTable(
  'match_participants',
  {
    matchId: text('match_id').notNull(),
    puuid: text('puuid').notNull(),
    slot: integer('slot').notNull(),               // 0..9
    team: text('team').notNull(),                  // 'blue' | 'red'
    lane: text('lane').notNull(),                  // 'top'|'jungle'|'mid'|'adc'|'support'
    role: text('role'),
    championId: integer('champion_id').notNull(),
    championKey: text('champion_key').notNull(),   // ddragon "Aatrox"
    win: boolean('win').notNull(),

    // KDA + KP
    kills: integer('kills').notNull(),
    deaths: integer('deaths').notNull(),
    assists: integer('assists').notNull(),
    kp: real('kp'),                                 // %, computed at ingest

    // Farm
    cs: integer('cs').notNull(),
    csAt14: integer('cs_at_14'),
    csDiffAt14: integer('cs_diff_at_14'),

    // Economy
    goldPerMin: real('gold_per_min').notNull(),
    xpPerMin: real('xp_per_min').notNull(),

    // Damage
    dmgToChampPerMin: real('dmg_to_champ_per_min').notNull(),
    dmgToObj: integer('dmg_to_obj').notNull(),
    damageTakenPerMin: real('damage_taken_per_min').notNull(),
    dmgMitigatedPerMin: real('dmg_mitigated_per_min'),

    // Vision
    visionScore: integer('vision_score').notNull(),
    wardsPlaced: integer('wards_placed').notNull(),
    wardsKilled: integer('wards_killed').notNull(),

    // Death
    timeDeadPct: real('time_dead_pct').notNull(),

    // Bonuses
    soloKills: integer('solo_kills').default(0).notNull(),
    multiKills: integer('multi_kills').default(0).notNull(),

    // Items + spells (denormalized arrays)
    items: jsonb('items').notNull(),               // number[7]
    spells: jsonb('spells').notNull(),             // [d, f]
    runes: jsonb('runes'),                         // { keystone, secondary, perks[] }

    // Precomputed AI Score (absolute LUT, computed at ingest)
    aiScoreCached: real('ai_score_cached'),
    aiScoreLetter: text('ai_score_letter'),         // 'S+'|'S'|'A'|'B'|'C'|'D'
    aiScoreAlgoVersion: text('ai_score_algo_version'),

    rawParticipant: jsonb('raw_participant').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.matchId, t.puuid] }),
    puuidIdx: index('mp_puuid_idx').on(t.puuid, t.ingestedAt),
    laneChampIdx: index('mp_lane_champ_idx').on(t.lane, t.championId),
    championIdx: index('mp_champion_idx').on(t.championId, t.lane),
  }),
);

export type MatchParticipant = typeof matchParticipants.$inferSelect;
export type NewMatchParticipant = typeof matchParticipants.$inferInsert;
