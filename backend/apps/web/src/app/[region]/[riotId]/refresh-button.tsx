'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  puuid: string;
}

export function RefreshButton({ puuid }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
      const res = await fetch(`${base}/api/summoner/${puuid}/refresh`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setMsg(body.message ?? '잠시 후 다시 시도해주세요');
        return;
      }
      if (!res.ok) {
        setMsg(body.error ?? '갱신 실패');
        return;
      }
      setMsg('갱신 요청 완료 — 잠시 후 새로고침');
      // ISR cache hold for a few seconds so the worker has time to ingest.
      setTimeout(() => router.refresh(), 4000);
    } catch (e) {
      setMsg('네트워크 오류');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="primary" type="button" onClick={onClick} disabled={busy}>
        {busy ? '갱신 중…' : '전적 갱신'}
      </button>
      {msg && <span className="text-tertiary" style={{ fontSize: 11, marginLeft: 8 }}>{msg}</span>}
    </>
  );
}
