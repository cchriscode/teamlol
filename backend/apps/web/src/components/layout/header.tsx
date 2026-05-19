import Link from 'next/link';
import { NAV_ITEMS, type NavKey } from './nav-config';
import { HeaderSearch } from './header-search';
import { RegionSelect } from './region-select';
import { NavBurger } from './nav-burger';
import { ThemeToggle } from './theme-toggle';

interface HeaderProps {
  activeKey?: NavKey;
  showHeaderSearch?: boolean;
  searchPlaceholder?: string;
}

export function Header({ activeKey, showHeaderSearch = false, searchPlaceholder }: HeaderProps) {
  return (
    <header className="header">
      <div className="header-inner">
        <div className="header-brand">
          <Link href="/" className="logo" aria-label="TeamLOL 홈">TeamLOL</Link>
          <nav className="nav-links" aria-label="주요 메뉴">
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
        </div>
        {showHeaderSearch && <HeaderSearch placeholder={searchPlaceholder} />}
        <div className="header-tools">
          <RegionSelect />
          <ThemeToggle />
          <NavBurger activeKey={activeKey} />
        </div>
      </div>
    </header>
  );
}
