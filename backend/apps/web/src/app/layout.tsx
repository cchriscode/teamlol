import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Analytics } from '@vercel/analytics/next';
import { HeaderWithActive } from '@/components/layout/header-with-active';
import { Footer } from '@/components/layout/footer';
import { TopProgress } from '@/components/layout/top-progress';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'TeamLOL — League of Legends 전적 검색',
  description: '한국 솔로/듀오 랭크 매치 분석 사이트',
};

// Sync init so the chosen palette is on <html> before first paint. The
// cookie covers SSR; the inline script reconciles client localStorage and
// (for visitors with no preference yet) honours prefers-color-scheme.
// Default is LIGHT — only flip to dark when a user explicitly opted in or
// their system prefers dark.
const THEME_INIT_SCRIPT = `(function(){try{var c=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=c?c[1]:null;if(!t){try{t=localStorage.getItem('theme');}catch(_){}}if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(_){document.documentElement.setAttribute('data-theme','light');}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get('theme')?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="ko" data-theme={theme}>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <TopProgress />
        <HeaderWithActive />
        {children}
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
