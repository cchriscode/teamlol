import Link from 'next/link';

const FOOTER_DISCLAIMER =
  "TeamLOL isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc. League of Legends © Riot Games, Inc.";

const FOOTER_LINKS = [
  { href: '/about',   label: '서비스 소개' },
  { href: '/terms',   label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침' },
  { href: '/privacy#delete', label: '데이터 삭제 요청' },
  { href: 'mailto:bj1304@naver.com', label: '문의' },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <p className="footer-attribution">
          Game data provided by{' '}
          <a href="https://developer.riotgames.com" target="_blank" rel="noopener noreferrer">
            Riot Games Developer API
          </a>
          .
        </p>
        <p>{FOOTER_DISCLAIMER}</p>
        <p>© 2026 TeamLOL</p>
        <div className="footer-links">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href}>{l.label}</Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
