import { pgTable, text, integer, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Mirror of ddragon /data/{lang}/champion.json + champion/{name}.json.
// Refreshed by W10 when a new patch ships.
export const staticChampions = pgTable(
  'static_champions',
  {
    patch: text('patch').notNull(),
    key: text('key').notNull(),                 // ddragon key, e.g. 'Aatrox'
    id: integer('id').notNull(),                // numeric champion id
    nameKr: text('name_kr').notNull(),
    nameEn: text('name_en').notNull(),
    title: text('title'),
    lanes: jsonb('lanes').notNull(),            // string[]
    tags: jsonb('tags').notNull(),              // ddragon "tags" array
    infoDifficulty: integer('info_difficulty'),
    blindPickSafe: integer('blind_pick_safe').default(0).notNull(), // 0/1 (curated)
    rawData: jsonb('raw_data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.key] }),
    idIdx: index('static_champ_id_idx').on(t.patch, t.id),
  }),
);

export const staticItems = pgTable(
  'static_items',
  {
    patch: text('patch').notNull(),
    id: integer('id').notNull(),
    nameKr: text('name_kr').notNull(),
    nameEn: text('name_en').notNull(),
    rawData: jsonb('raw_data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.patch, t.id] }) }),
);

export const staticRunes = pgTable(
  'static_runes',
  {
    patch: text('patch').notNull(),
    id: integer('id').notNull(),
    treeKey: text('tree_key').notNull(),        // 'Domination', 'Sorcery', ...
    runeKey: text('rune_key').notNull(),        // 'Electrocute', 'ArcaneComet', ...
    nameKr: text('name_kr').notNull(),
    iconPath: text('icon_path').notNull(),
    rawData: jsonb('raw_data').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.patch, t.id] }) }),
);

export const staticVersions = pgTable(
  'static_versions',
  {
    patch: text('patch').primaryKey(),
    locale: text('locale').notNull(),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
    isCurrent: integer('is_current').default(0).notNull(),
  },
);
