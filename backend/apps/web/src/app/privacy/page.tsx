export const metadata = { title: '개인정보처리방침 — TeamLOL' };

export default function PrivacyPage() {
  return (
    <main className="page">
      <h1 className="page-title">개인정보처리방침</h1>
      <div className="card" style={{ padding: 24, marginTop: 16, lineHeight: 1.7 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>수집 정보</h2>
        <p>
          - 검색 로그 (Riot ID, 검색 시각): 인기 검색어 산출용으로 IP는 해시 처리 후 저장.<br />
          - 쿠키/로컬스토리지: 선택한 서버(KR/NA 등) 저장.
        </p>
        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>제3자 제공</h2>
        <p>없습니다.</p>
        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>문의</h2>
        <p>contact@example.com</p>
      </div>
    </main>
  );
}
