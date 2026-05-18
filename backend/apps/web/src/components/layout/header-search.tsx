'use client';

import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useSearchSuggest } from './use-search-suggest';
import { slugFromRiotId } from '@/lib/riot-id';

const TIER_SHORT: Record<string, string> = {
  IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
  EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'CH',
};
const tierShort = (t: string) => TIER_SHORT[t] ?? t;

interface Props {
  placeholder?: string;
}

export function HeaderSearch({ placeholder = '소환사명 또는 이름#태그' }: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { matches } = useSearchSuggest(value, 'kr');

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
    setValue('');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.includes('#')) {
      const [name, tag] = trimmed.split('#');
      if (name && tag) navTo(name, tag);
      return;
    }
    if (matches.length >= 1) navTo(matches[0].gameName, matches[0].tagLine);
  };

  return (
    <div ref={wrapRef} className="header-search-wrap">
      <form className="header-search" role="search" onSubmit={onSubmit}>
        <svg className="header-search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" />
        </svg>
        <label className="sr-only" htmlFor="header-search-input">소환사 검색</label>
        <input
          id="header-search-input"
          type="text"
          placeholder={placeholder}
          autoComplete="off"
          value={value}
          onChange={(e) => { setValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
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
              {m.tier && (
                <span className={`search-suggest-tier tier-${m.tier.toLowerCase()}`}>
                  {tierShort(m.tier)}{m.rank ? ` ${m.rank}` : ''}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
