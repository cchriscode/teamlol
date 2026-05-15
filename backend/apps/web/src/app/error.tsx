'use client';

import Link from 'next/link';

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page" style={{ textAlign: 'center', padding: 64 }}>
      <h1 className="page-title" style={{ fontSize: 36 }}>오류 발생</h1>
      <p className="page-subtitle" style={{ marginTop: 8 }}>{error.message}</p>
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'center', gap: 12 }}>
        <button className="primary" type="button" onClick={() => reset()}>다시 시도</button>
        <Link href="/" className="filter-chip" style={{ display: 'inline-flex', alignItems: 'center' }}>홈으로</Link>
      </div>
    </main>
  );
}
