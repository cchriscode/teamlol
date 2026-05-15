export const metadata = { title: '이용약관 — TeamLOL' };

export default function TermsPage() {
  return (
    <main className="page">
      <h1 className="page-title">이용약관</h1>
      <div className="card" style={{ padding: 24, marginTop: 16, lineHeight: 1.7 }}>
        <p>본 사이트는 League of Legends 통계 정보를 제공합니다.</p>
        <p style={{ marginTop: 12 }}>
          데이터의 정확성을 보장하지 않으며, 본 사이트 사용으로 발생하는 손해에 대해 책임지지 않습니다.
        </p>
        <p style={{ marginTop: 12 }}>
          TeamLOL is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games.
          League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </div>
    </main>
  );
}
