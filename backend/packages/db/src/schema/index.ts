// Single import surface for the Drizzle schema.
// Add a new table → re-export it here so drizzle-kit picks it up.
//
// NOTE: drizzle-kit (CJS) loads this file directly via `require`, so we use
// extension-less imports here. Runtime code (under client.ts/index.ts) uses
// `.js` for ESM compatibility — both work because of moduleResolution: Bundler.

export * from './accounts';
export * from './summoners';
export * from './league-entries';
export * from './matches';
export * from './match-participants';
export * from './match-timelines';
export * from './champion-stats';
export * from './champion-power';
export * from './champion-matchups';
export * from './champion-synergies';
export * from './bot-duo-synergy';
export * from './copick-probs';
export * from './champion-masteries';
export * from './tier-snapshots';
export * from './player-rank-history';
export * from './lp-snapshots';
export * from './data-deletion';
export * from './search-logs';
export * from './static-data';
