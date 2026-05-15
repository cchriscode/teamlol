'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function HeroSearch() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (!trimmed.includes('#')) {
      setError('Riot ID 형식: 이름#태그 (예: Hide on bush#KR1)');
      return;
    }
    const [name, tag] = trimmed.split('#');
    if (!name || !tag) {
      setError('Riot ID 형식: 이름#태그');
      return;
    }
    router.push(`/kr/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`);
  };

  return (
    <>
      <form className="hero-search" role="search" onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="hero-input">소환사 검색</label>
        <input
          id="hero-input"
          type="text"
          placeholder="이름#KR1"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="primary" type="submit">검색</button>
      </form>
      {error && <div className="hero-hint" style={{ color: 'var(--color-loss)' }}>{error}</div>}
    </>
  );
}
