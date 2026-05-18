'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useSearchSuggest } from '@/components/layout/use-search-suggest';
import { slugFromRiotId } from '@/lib/riot-id';

const TIER_SHORT: Record<string, string> = {
  IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
  EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'CH',
};
const tierShort = (t: string) => TIER_SHORT[t] ?? t;

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
    <div ref={wrapRef} className="hero-search-wrap">
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
      {open && (matches.length > 0 || (value.trim().length >= 2 && !value.includes('#'))) && (
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
              {m.tier && (
                <span className={`search-suggest-tier tier-${m.tier.toLowerCase()}`}>
                  {tierShort(m.tier)}{m.rank ? ` ${m.rank}` : ''}
                </span>
              )}
            </button>
          ))}
          {matches.length === 0 && !loading && (
            <div className="search-suggest-row text-tertiary" style={{ cursor: 'default' }}>
              일치 없음 — 이름#태그 형식으로 직접 입력하세요
            </div>
          )}
          {loading && <div className="search-suggest-row text-tertiary" style={{ cursor: 'default' }}>…</div>}
        </div>
      )}
      {error && <div className="hero-hint" style={{ color: 'var(--color-loss)' }}>{error}</div>}
    </div>
  );
}
