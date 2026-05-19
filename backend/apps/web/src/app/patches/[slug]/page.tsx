import { cache } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiGet, ApiError } from '@/lib/api';

export const revalidate = 86400; // 24h

interface PatchDetail {
  title: string;
  slug: string;
  url: string;
  publishedAt: string;
  banner: string | null;
  description: string;
  html: string;
}

interface PageProps { params: Promise<{ slug: string }>; }

// React.cache() dedupes the upstream call so generateMetadata and the page
// body share one fetch per render. Next's fetch cache also dedupes, but this
// is explicit at the function boundary.
const getPatch = cache(async (slug: string) =>
  apiGet<PatchDetail>(`/api/patch-notes/${slug}`, { next: { revalidate: 86400 } }).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  }));

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const d = await getPatch(slug);
  if (!d) return { title: '패치 노트 — TeamLOL' };
  return { title: `${d.title} — TeamLOL`, description: d.description };
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PatchDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await getPatch(slug);
  if (!data) notFound();

  return (
    <main className="page page-wide">
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Link href="/patches" className="text-tertiary" style={{ fontSize: 12 }}>← 패치 노트 목록</Link>
      </div>

      <header className="tier-page-header">
        <div>
          <h1 className="page-title">{data.title}</h1>
          <div className="page-subtitle">
            게시일 {formatDate(data.publishedAt)} · <a href={data.url} target="_blank" rel="noopener noreferrer">라이엇 원문</a>
          </div>
        </div>
      </header>

      {data.banner && (
        <div className="patch-banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.banner} alt="" />
        </div>
      )}

      <article
        className="patch-article"
        // Server-sanitized in API route (scripts/handlers stripped).
        dangerouslySetInnerHTML={{ __html: data.html }}
      />

      <p className="text-tertiary" style={{ fontSize: 11, marginTop: 'var(--space-4)', lineHeight: 1.7 }}>
        © Riot Games, Inc. · 본문은 라이엇 공식 패치 노트에서 가져왔습니다.
      </p>
    </main>
  );
}
