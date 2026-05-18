// Single source of truth for header navigation. Mirrors prototype/layout.js.

export type NavKey = 'search' | 'champions' | 'leaderboard' | 'multi-search' | 'pick-recommend' | 'patches';

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  badge?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'search',         href: '/',                 label: '소환사검색' },
  { key: 'champions',      href: '/champions',        label: '챔피언' },
  { key: 'leaderboard',    href: '/leaderboard',      label: '랭킹' },
  { key: 'multi-search',   href: '/multi',            label: '멀티서치' },
  { key: 'pick-recommend', href: '/pick',             label: '픽 추천', badge: 'BETA' },
  { key: 'patches',        href: '/patches',          label: '패치노트' },
];

export const REGIONS = ['KR', 'NA', 'EUW', 'EUNE', 'JP', 'BR', 'OCE', 'TR', 'RU', 'VN', 'TW'] as const;
export type Region = typeof REGIONS[number];
export const DEFAULT_REGION: Region = 'KR';
export const REGION_STORAGE_KEY = 'lol-tracker:region';
