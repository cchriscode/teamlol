'use client';

import { useState } from 'react';
import Link from 'next/link';
import { NAV_ITEMS, type NavKey } from './nav-config';

export function NavBurger({ activeKey }: { activeKey?: NavKey }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="nav-burger"
        type="button"
        aria-label="메뉴 열기"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 4h12M2 8h12M2 12h12" />
        </svg>
      </button>
      <nav className="nav-mobile" hidden={!open} aria-label="모바일 메뉴">
        {NAV_ITEMS.map((item) => {
          const isActive = item.key === activeKey;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={isActive ? 'active' : undefined}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.label}
              {item.badge && <span className="nav-badge">{item.badge}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
