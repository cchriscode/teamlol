import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page" style={{ textAlign: 'center', padding: 64 }}>
      <h1 className="page-title" style={{ fontSize: 48 }}>404</h1>
      <p className="page-subtitle" style={{ marginTop: 8 }}>페이지를 찾을 수 없습니다.</p>
      <p style={{ marginTop: 24 }}>
        <Link href="/" style={{ color: 'var(--text-secondary)' }}>← 홈으로</Link>
      </p>
    </main>
  );
}
