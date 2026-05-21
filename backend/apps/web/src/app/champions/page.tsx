import { redirect } from 'next/navigation';

// Root /champions redirects to the default bracket+lane. The real list
// lives at /champions/[bracket]/[lane] (static-cached per pair). Path
// slugs use `-plus` instead of `+` so URL encoding never breaks matching.
const BRACKET_TO_SLUG: Record<string, string> = {
  'emerald+':   'emerald-plus',
  'diamond+':   'diamond-plus',
  'master+':    'master-plus',
  'gm+':        'gm-plus',
  'challenger': 'challenger',
};

export default async function ChampionsRoot({
  searchParams,
}: {
  searchParams: Promise<{ bracket?: string; lane?: string }>;
}) {
  const sp = await searchParams;
  const bracketSlug = BRACKET_TO_SLUG[sp.bracket ?? ''] ?? 'emerald-plus';
  const lane = sp.lane ?? 'all';
  redirect(`/champions/${bracketSlug}/${encodeURIComponent(lane)}`);
}
