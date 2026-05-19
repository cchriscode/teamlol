'use client';

// Theme toggle — flips html[data-theme] between "dark" and "light".
// Persists via cookie (read on server for no-flash SSR) + localStorage
// (read on client for snappy toggling without a round-trip).

import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;
  return 'light';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('theme', theme); } catch { /* localStorage may be unavailable */ }
  // 1-year cookie so SSR can paint the right palette on the next request.
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const onClick = () => {
    setTheme(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onClick}
      aria-label={next === 'light' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      title={next === 'light' ? '라이트 모드' : '다크 모드'}
    >
      {theme === 'dark' ? (
        // Moon — currently dark, click switches to light
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // Sun — currently light, click switches to dark
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  );
}
