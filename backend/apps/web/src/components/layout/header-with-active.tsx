'use client';

import { usePathname } from 'next/navigation';
import { Header } from './header';
import { activeKeyForPath } from './active-key';

interface Props {
  showHeaderSearch?: boolean;
}

export function HeaderWithActive({ showHeaderSearch }: Props) {
  const pathname = usePathname();
  return <Header activeKey={activeKeyForPath(pathname)} showHeaderSearch={showHeaderSearch} />;
}
