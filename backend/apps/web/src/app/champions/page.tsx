import { redirect } from 'next/navigation';

// Root /champions redirects to the default bracket+lane. The real list
// lives at /champions/[bracket]/[lane] (static-cached per pair). Also
// preserves back-compat for users with bookmarked ?bracket=&lane=
// query strings — we route them to the equivalent path.
export default async function ChampionsRoot({
  searchParams,
}: {
  searchParams: Promise<{ bracket?: string; lane?: string }>;
}) {
  const sp = await searchParams;
  const bracket = sp.bracket ?? 'diamond+';
  const lane = sp.lane ?? 'all';
  redirect(`/champions/${encodeURIComponent(bracket)}/${encodeURIComponent(lane)}`);
}
