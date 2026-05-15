import Link from 'next/link';

const FOOTER_DISCLAIMER =
  'TeamLOL is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.';

const FOOTER_LINKS = [
  { href: '/about',   label: '서비스 소개' },
  { href: '/terms',   label: '이용약관' },
  { href: '/privacy', label: '개인정보처리방침' },
  { href: 'mailto:contact@example.com', label: '문의' },
];

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
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
