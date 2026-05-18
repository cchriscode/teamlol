import Link from 'next/link';
import { apiGet } from '@/lib/api';

export const revalidate = 21600; // 6h — matches API cache
export const metadata = { title: '패치 노트 — TeamLOL' };

interface PatchSummary {
  title: string;
  slug: string;
  url: string;
  publishedAt: string;
  description: string;
  thumbnail: string | null;
  category: string | null;
}
interface PatchListResponse {
  fetchedAt: string;
  count: number;
  entries: PatchSummary[];
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PatchesIndexPage() {
  const data = await apiGet<PatchListResponse>('/api/patch-notes?limit=24', {
    next: { revalidate: 21600 },
  }).catch(() => null);

  return (
    <main className="page">
      <header className="tier-page-header">
        <div>
          <h1 className="page-title">패치 노트</h1>
          <div className="page-subtitle">
            라이엇 공식 한국어 패치 노트 · 출처 leagueoflegends.com
          </div>
        </div>
      </header>

      {!data || data.entries.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          패치 노트를 불러올 수 없습니다.
        </div>
      ) : (
        <div className="patch-card-grid">
          {data.entries.map((p) => (
            <Link key={p.slug} href={`/patches/${p.slug}`} className="card patch-card">
              {p.thumbnail && (
                <div className="patch-card-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumbnail} alt="" loading="lazy" />
                </div>
              )}
              <div className="patch-card-body">
                <div className="patch-card-date">{formatDate(p.publishedAt)}</div>
                <div className="patch-card-title">{p.title}</div>
                {p.description && (
                  <div className="patch-card-desc">{p.description}</div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="text-tertiary" style={{ fontSize: 11, marginTop: 'var(--space-4)', lineHeight: 1.7 }}>
        © Riot Games, Inc. · 패치 노트 원문은 라이엇 공식 사이트에서 확인하세요.
      </p>
    </main>
  );
}
