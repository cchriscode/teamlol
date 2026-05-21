import { redirect } from 'next/navigation';

// Root /leaderboard redirects to the default tier. The real listing
// lives at /leaderboard/[tier] (static-cached per tier).
export default async function LeaderboardRoot({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>;
}) {
  const sp = await searchParams;
  const tier = sp.tier ?? 'challenger';
  redirect(`/leaderboard/${encodeURIComponent(tier)}`);
}
