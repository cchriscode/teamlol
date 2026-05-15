export const metadata = { title: '서비스 소개 — TeamLOL' };

export default function AboutPage() {
  return (
    <main className="page">
      <h1 className="page-title">서비스 소개</h1>
      <div className="card" style={{ padding: 24, marginTop: 16, lineHeight: 1.7 }}>
        <p>
          <strong>TeamLOL</strong>은 한국 솔로/듀오 랭크 매치를 분석하는 사이트입니다.
        </p>
        <ul style={{ marginTop: 12, paddingLeft: 20 }}>
          <li>소환사 검색 — Riot ID(이름#태그)로 프로필·랭크·매치 히스토리 확인</li>
          <li>챔피언 티어표 — 라인·티어별 픽률·승률·밴율 통계</li>
          <li>픽 추천 — 드래프트 단계에서 카운터/시너지/EV 기반 챔피언 추천</li>
          <li>랭킹 — Challenger / GM / Master 리더보드</li>
        </ul>
        <p style={{ marginTop: 16 }}>
          데이터는 Riot Games API에서 실시간 수집됩니다.
          TeamLOL is not endorsed by Riot Games.
        </p>
      </div>
    </main>
  );
}
