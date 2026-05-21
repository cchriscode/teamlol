import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { HeaderWithActive } from '@/components/layout/header-with-active';
import { Footer } from '@/components/layout/footer';
import { TopProgress } from '@/components/layout/top-progress';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'TeamLOL — League of Legends 전적 검색',
  description: '한국 솔로/듀오 랭크 매치 분석 사이트',
};

// Default theme rendered into the SSR HTML. Real theme is set by the
// init script below before paint, so any mismatch is invisible. Keeping
// this static (no cookies() call in the layout) is what lets child pages
// stay ISR-eligible — reading cookies in layout opts the entire tree
// into dynamic rendering and would block all page caching.
const DEFAULT_THEME = 'light';

// Reads `theme` cookie or `localStorage.theme`, falling back to OS
// preference (prefers-color-scheme: dark → dark, else light). Runs as the
// first script in <head> so the chosen palette is applied to the
// documentElement before the browser paints — no FOUC.
const THEME_INIT_SCRIPT = `(function(){try{var c=document.cookie.match(/(?:^|; )theme=([^;]+)/);var t=c?c[1]:null;if(!t){try{t=localStorage.getItem('theme');}catch(_){}}if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(_){document.documentElement.setAttribute('data-theme','light');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme={DEFAULT_THEME}>
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
