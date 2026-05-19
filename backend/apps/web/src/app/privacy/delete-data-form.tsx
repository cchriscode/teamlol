'use client';

import { useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

// Self-serve GDPR-style data deletion request. The endpoint queues the
// request — actual DB cleanup runs out-of-band in the worker so the user's
// click isn't blocked on a multi-table delete.
export function DeleteDataForm() {
  const [riotId, setRiotId] = useState('');
  const [region, setRegion] = useState('kr');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!riotId.includes('#') || !agree) return;
    if (!confirm('이 Riot ID에 연결된 모든 데이터를 삭제 요청합니다. 되돌릴 수 없습니다. 계속할까요?')) return;

    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_BASE}/api/user/delete-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riotId, region }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: 'err', text: body.error ?? body.message ?? '요청 실패' });
        return;
      }
      setMsg({ kind: 'ok', text: `요청 접수되었습니다 (ID: ${body.requestId ?? '—'}). 24시간 내 처리됩니다.` });
      setRiotId('');
      setAgree(false);
    } catch {
      setMsg({ kind: 'err', text: '네트워크 오류' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="delete-data-form">
      <div className="delete-data-row">
        <label>
          <span>Riot ID (이름#태그)</span>
          <input
            type="text"
            placeholder="Hide on bush#KR1"
            value={riotId}
            onChange={(e) => setRiotId(e.target.value)}
            required
          />
        </label>
        <label>
          <span>지역</span>
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="kr">KR</option>
            <option value="na1">NA</option>
            <option value="euw1">EUW</option>
            <option value="eun1">EUNE</option>
            <option value="jp1">JP</option>
          </select>
        </label>
      </div>
      <label className="delete-data-agree">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>본인 데이터임을 확인하며, 삭제 후 동일 Riot ID가 자동으로 다시 수집되지 않음에 동의합니다.</span>
      </label>
      <button type="submit" className="delete-data-submit"
              disabled={busy || !riotId.includes('#') || !agree}>
        {busy ? '요청 중…' : '데이터 삭제 요청'}
      </button>
      {msg && (
        <div className={msg.kind === 'ok' ? 'text-positive' : 'text-loss'} style={{ fontSize: 12 }}>
          {msg.text}
        </div>
      )}
    </form>
  );
}
