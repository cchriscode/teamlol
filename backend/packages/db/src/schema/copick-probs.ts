import { pgTable, text, integer, real, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

// Conditional pick frequency: P(partner | anchor). W7 output.
// Drives pick-engine predictMissingPick (spec §17). Sparse — only "anchor" champs
// that bias their team comp strongly.
export const copickProbs = pgTable(
  'copick_probs',
  {
    patch: text('patch').notNull(),
    bracket: text('bracket').notNull(),
    anchorRole: text('anchor_role').notNull(),    // 'mid', 'top', etc.
    anchorId: integer('anchor_id').notNull(),
    partnerRole: text('partner_role').notNull(),
    partnerId: integer('partner_id').notNull(),
    cooccurCount: integer('cooccur_count').notNull(),
    anchorTotal: integer('anchor_total').notNull(),
    prob: real('prob').notNull(),                  // smoothed (Dirichlet α=1)
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.patch, t.bracket, t.anchorRole, t.anchorId, t.partnerRole, t.partnerId] }),
    anchorIdx: index('cp_anchor_idx').on(t.anchorRole, t.anchorId, t.partnerRole, t.prob),
  }),
);
