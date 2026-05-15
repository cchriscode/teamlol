import type { NavKey } from './nav-config';

// Map URL pathname → NavKey for header active state.
export function activeKeyForPath(pathname: string): NavKey | undefined {
  if (pathname === '/' || pathname.startsWith('/kr/') || pathname.startsWith('/na1/')) return 'search';
  if (pathname.startsWith('/champions')) return 'champions';
  if (pathname.startsWith('/leaderboard')) return 'leaderboard';
  if (pathname.startsWith('/multi')) return 'multi-search';
  if (pathname.startsWith('/pick')) return 'pick-recommend';
  return undefined;
}
