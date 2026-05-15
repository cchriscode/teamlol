'use client';

import Link from 'next/link';
import { useState } from 'react';
import { slugFromRiotId, type RiotId } from '@/lib/riot-id';

interface ParsedRow {
  raw: string;
  riotId?: RiotId;
  error?: string;
}

function parseLine(line: string): ParsedRow {
  const trimmed = line.trim();
  if (!trimmed) return { raw: trimmed, error: '빈 줄' };
  const idx = trimmed.indexOf('#');
  if (idx < 1 || idx === trimmed.length - 1) {
    return { raw: trimmed, error: '형식: 이름#태그' };
  }
  return {
    raw: trimmed,
    riotId: { gameName: trimmed.slice(0, idx).trim(), tagLine: trimmed.slice(idx + 1).trim() },
  };
}

export function MultiSearchForm() {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<ParsedRow[] | null>(null);
  const region = 'kr';

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParsed(text.split(/\r?\n/).map(parseLine));
  };

  return (
    <>
      <form onSubmit={onSubmit} className="card" style={{ padding: 16 }}>
        <label className="filter-label" htmlFor="multi-input">Riot ID 목록</label>
        <textarea
          id="multi-input"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'Hide on bush#KR1\nChovy#KR1\nFaker#T1'}
          style={{
            width: '100%', marginTop: 8, padding: 12,
            background: 'var(--bg-input)',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontFamily: 'inherit', fontSize: 13,
            fontFeatureSettings: '"tnum" on',
          }}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="submit" className="primary">검색</button>
          {parsed && (
            <button type="button" className="filter-chip" onClick={() => { setText(''); setParsed(null); }}>
              초기화
            </button>
          )}
        </div>
      </form>

      {parsed && (
        <div className="card" style={{ marginTop: 16, padding: 0 }}>
          <div className="section-title" style={{ padding: 16 }}>
            <span>결과</span>
            <span className="meta">{parsed.filter((p) => p.riotId).length}명 / {parsed.length}줄</span>
          </div>
          {parsed.map((row, i) => (
            <div
              key={i}
              style={{
                padding: '12px 16px',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                {row.riotId ? (
                  <>
                    <span className="fw-medium">{row.riotId.gameName}</span>
                    <span className="text-tertiary"> #{row.riotId.tagLine}</span>
                  </>
                ) : (
                  <>
                    <span className="text-tertiary">{row.raw || '(빈 줄)'}</span>
                    <span style={{ marginLeft: 8, color: 'var(--color-loss)', fontSize: 12 }}>{row.error}</span>
                  </>
                )}
              </div>
              {row.riotId && (
                <Link
                  href={`/${region}/${slugFromRiotId(row.riotId)}`}
                  className="filter-chip"
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  열기 →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
