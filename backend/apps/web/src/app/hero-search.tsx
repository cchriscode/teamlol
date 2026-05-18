'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useSearchSuggest } from '@/components/layout/use-search-suggest';
import { slugFromRiotId } from '@/lib/riot-id';

export function HeroSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { matches, loading } = useSearchSuggest(value, 'kr');

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const navTo = (gameName: string, tagLine: string) => {
    router.push(`/kr/${slugFromRiotId({ gameName, tagLine })}`);
    setOpen(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (trimmed.includes('#')) {
      const [name, tag] = trimmed.split('#');
      if (!name || !tag) { setError('Riot ID 형식: 이름#태그'); return; }
      navTo(name, tag);
      return;
    }
    if (matches.length === 1) { navTo(matches[0].gameName, matches[0].tagLine); return; }
    if (matches.length === 0) {
      setError('일치하는 소환사가 없습니다. 이름#태그 형식으로 입력하세요');
      return;
    }
    setError('여러 명이 검색됩니다. 아래에서 선택해주세요');
    setOpen(true);
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <form className="hero-search" role="search" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="hero-input">소환사 검색</label>
        <input
          id="hero-input"
          type="text"
          placeholder="이름 또는 이름#KR1"
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setOpen(true); setError(null); }}
          onFocus={() => setOpen(true)}
        />
        <button className="primary" type="submit">검색</button>
      </form>
      {open && matches.length > 0 && (
        <div className="search-suggest" role="listbox">
          {matches.map((m) => (
            <button
              key={m.puuid}
              type="button"
              className="search-suggest-row"
              onClick={() => navTo(m.gameName, m.tagLine)}
            >
              <span className="search-suggest-name">{m.gameName}</span>
              <span className="search-suggest-tag">#{m.tagLine}</span>
            </button>
          ))}
          {loading && <div className="search-suggest-row text-tertiary">…</div>}
        </div>
      )}
      {error && <div className="hero-hint" style={{ color: 'var(--color-loss)' }}>{error}</div>}
    </div>
  );
}
