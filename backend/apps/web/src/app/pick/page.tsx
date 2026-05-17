import { apiGet } from '@/lib/api';
import { getChampionMeta } from '@/lib/champion-meta';
import { buildPickData } from './build-pick-data';
import { PickRecommendApp } from './pick-recommend-app';

export const revalidate = 600;
export const metadata = { title: '픽 추천 — TeamLOL' };

export default async function PickPage() {
  // Fetch the data layer once on the server. Engine + UI run on the client.
  const [api, meta] = await Promise.all([
    apiGet<Parameters<typeof buildPickData>[0]>('/api/pick-recommend/data?bracket=diamond%2B', {
      next: { revalidate: 600 },
    }),
    getChampionMeta(),
  ]);

  const data = buildPickData(api, { byId: meta.byId, byKey: meta.byKey });
  // Strip Map-typed function for serialization to client (re-attached there).
  const serializable = JSON.parse(JSON.stringify(data));

  return (
    <main className="page page-wide">
      <PickRecommendApp initialData={serializable} />
    </main>
  );
}
