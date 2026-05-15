import type { Metadata } from 'next';
import { HeaderWithActive } from '@/components/layout/header-with-active';
import { Footer } from '@/components/layout/footer';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: 'TeamLOL — League of Legends 전적 검색',
  description: '한국 솔로/듀오 랭크 매치 분석 사이트',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css"
        />
      </head>
      <body>
        <HeaderWithActive />
        {children}
        <Footer />
      </body>
    </html>
  );
}
