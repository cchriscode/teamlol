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

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  try {
    const d = await apiGet<PatchDetail>(`/api/patch-notes/${slug}`, { next: { revalidate: 86400 } });
    return { title: `${d.title} — TeamLOL`, description: d.description };
  } catch {
    return { title: '패치 노트 — TeamLOL' };
  }
}

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default async function PatchDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const data = await apiGet<PatchDetail>(`/api/patch-notes/${slug}`, {
    next: { revalidate: 86400 },
  }).catch((e) => {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return null;
    throw e;
  });
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
