import { pgTable, text, integer, real, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// ADC + Support pair winrate. W6 output. Used by pick-engine D_duo (spec §16).
// archetype is one of: 'engage'|'poke'|'pick'|'protect'|'sustain'|'onhit'|'killlane'
// (manually curated tag joined from a static table or computed heuristically).
export const botDuoSynergy = pgTable(
  'bot_duo_synergy',
  {
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),
    adcId: integer('adc_id').notNull(),
    supId: integer('sup_id').notNull(),
    games: integer('games').notNull(),
    wins: integer('wins').notNull(),
    pairWinrate: real('pair_winrate').notNull(),
    synergyDelta: real('synergy_delta').notNull(),
    archetype: text('archetype'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.bracket, t.adcId, t.supId] }),
    adcIdx: index('bds_adc_idx').on(t.adcId, t.synergyDelta),
    supIdx: index('bds_sup_idx').on(t.supId, t.synergyDelta),
  }),
);
