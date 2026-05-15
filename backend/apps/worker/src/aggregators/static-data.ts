// W10 — static-data-sync.
//
// Mirrors ddragon `champion.json` + per-champion detail into our own DB
// (so frontends don't all hit ddragon, and so we have stable id↔key mapping
// for the API). Also derives a *first-pass* champion_meta tagging from
// ddragon's `info.attack`, `info.magic`, `info.difficulty`, and `tags`.
//
// Runs hourly (cheap) — only writes when ddragon version changes.

import { db, sql, schema } from '@lol-tracker/db';
import { logger } from '../logger.js';

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const LOCALE = 'ko_KR';

interface DdChampion {
  id: string;          // "Aatrox"
  key: string;         // "266" (numeric as string)
  name: string;        // "아트록스"
  title: string;
  tags: string[];      // ["Fighter","Tank"]
  info: { attack: number; defense: number; magic: number; difficulty: number };
  partype: string;
  stats: Record<string, number>;
}

interface DdItem {
  name: string;
  description?: string;
  plaintext?: string;
  gold?: { total: number; base: number; sell: number; purchasable: boolean };
  tags?: string[];
  maps?: Record<string, boolean>;
}

interface DdRuneTree {
  id: number;
  key: string;          // 'Domination'
  icon: string;
  name: string;
  slots: Array<{ runes: Array<{ id: number; key: string; icon: string; name: string }> }>;
}

export async function syncStaticData() {
  const log = logger.child({ aggregator: 'static-data' });

  // 1) Latest version
  const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json()) as string[];
  const latest = versions[0];
  if (!latest) { log.warn('no version returned'); return { skipped: true }; }

  // 2) Idempotent: each entity (champ/item/rune) has its own row count check.
  // Don't bail out at the version level — that's how items/runes ended up
  // permanently empty after the first sync.
  const champCount = await rowCount('static_champions', latest);
  const itemCount  = await rowCount('static_items', latest);
  const runeCount  = await rowCount('static_runes', latest);
  log.info({ patch: latest, champCount, itemCount, runeCount }, 'check');

  await db.transaction(async (tx) => {
    await tx.insert(schema.staticVersions).values({
      patch: latest, locale: LOCALE, isCurrent: 1,
    }).onConflictDoNothing();
    await tx.execute(sql`UPDATE static_versions SET is_current = 0 WHERE patch <> ${latest}`);
  });

  let champsWritten = 0, itemsWritten = 0, runesWritten = 0;
  if (champCount === 0) champsWritten = await syncChampions(latest, log);
  if (itemCount === 0)  itemsWritten  = await syncItems(latest, log);
  if (runeCount === 0)  runesWritten  = await syncRunes(latest, log);

  log.info({ patch: latest, champs: champsWritten, items: itemsWritten, runes: runesWritten }, 'static-data sync done');
  return { patch: latest, champs: champsWritten, items: itemsWritten, runes: runesWritten };
}

async function rowCount(table: string, patch: string): Promise<number> {
  const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS n FROM ${table} WHERE patch = '${patch.replace(/'/g, "''")}'`));
  return Number((r as unknown as Array<{ n: number }>)[0]?.n ?? 0);
}

async function syncChampions(patch: string, log: typeof logger): Promise<number> {
  const url = `${DDRAGON}/cdn/${patch}/data/${LOCALE}/champion.json`;
  const summary = await fetch(url).then((r) => r.json()) as { data: Record<string, DdChampion> };
  const champs = Object.values(summary.data);
  const rows = champs.map((c) => ({
    patch, key: c.id, id: Number(c.key),
    nameKr: c.name, nameEn: c.id, title: c.title,
    lanes: inferLanes(c) as never,
    tags: c.tags as never,
    infoDifficulty: c.info?.difficulty ?? null,
    blindPickSafe: 0,
    rawData: c as never,
  }));
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.staticChampions).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  log.info({ count: rows.length }, 'champions written');
  return rows.length;
}

async function syncItems(patch: string, log: typeof logger): Promise<number> {
  const url = `${DDRAGON}/cdn/${patch}/data/${LOCALE}/item.json`;
  const summary = await fetch(url).then((r) => r.json()) as { data: Record<string, DdItem> };
  const rows = Object.entries(summary.data).map(([id, it]) => ({
    patch, id: Number(id),
    nameKr: it.name, nameEn: it.name,
    rawData: it as never,
  }));
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.staticItems).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  log.info({ count: rows.length }, 'items written');
  return rows.length;
}

async function syncRunes(patch: string, log: typeof logger): Promise<number> {
  const url = `${DDRAGON}/cdn/${patch}/data/${LOCALE}/runesReforged.json`;
  const trees = await fetch(url).then((r) => r.json()) as DdRuneTree[];
  const rows: Array<typeof schema.staticRunes.$inferInsert> = [];
  for (const tree of trees) {
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        rows.push({
          patch, id: rune.id,
          treeKey: tree.key, runeKey: rune.key,
          nameKr: rune.name, iconPath: rune.icon,
          rawData: rune as never,
        });
      }
    }
  }
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.staticRunes).values(rows.slice(i, i + CHUNK)).onConflictDoNothing();
  }
  log.info({ count: rows.length }, 'runes written');
  return rows.length;
}

// Heuristic: ddragon doesn't give "lanes" directly. We infer a *default* from
// tags; the real lane distribution comes from match data (champion_stats).
// This is just a fallback for champs that haven't been picked yet.
function inferLanes(c: DdChampion): string[] {
  const tags = c.tags || [];
  if (tags.includes('Marksman')) return ['adc'];
  if (tags.includes('Support')) return ['support'];
  if (tags.includes('Tank') && tags.includes('Fighter')) return ['top'];
  if (tags.includes('Mage') && c.info?.attack < 4) return ['mid', 'support'];
  if (tags.includes('Assassin')) return ['mid', 'jungle'];
  if (tags.includes('Fighter')) return ['top', 'jungle'];
  if (tags.includes('Tank')) return ['top', 'jungle'];
  if (tags.includes('Mage')) return ['mid'];
  return ['mid'];
}
