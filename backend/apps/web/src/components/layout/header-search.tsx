'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Props {
  placeholder?: string;
}

export function HeaderSearch({ placeholder = '소환사명#태그' }: Props) {
  const router = useRouter();
  const [value, setValue] = useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed.includes('#')) return;
    const [name, tag] = trimmed.split('#');
    router.push(`/kr/${encodeURIComponent(name)}-${encodeURIComponent(tag)}`);
  };

  return (
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
        onChange={(e) => setValue(e.target.value)}
      />
    </form>
  );
}
