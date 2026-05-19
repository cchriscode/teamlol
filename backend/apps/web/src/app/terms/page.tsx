export const metadata = { title: '이용약관 — TeamLOL' };

export default function TermsPage() {
  return (
    <main className="page">
      <h1 className="page-title">이용약관</h1>
      <div className="card" style={{ padding: 24, marginTop: 16, lineHeight: 1.8, fontSize: 13 }}>
        <p className="text-tertiary" style={{ fontSize: 11, marginBottom: 16 }}>
          최종 업데이트 2026-05-19
        </p>

        <h2 style={{ fontSize: 16, marginBottom: 8 }}>1. 서비스 개요</h2>
        <p>TeamLOL은 Riot Games Developer API에서 제공하는 공개 데이터를 활용하여
          League of Legends 전적 검색, 통계, 픽 추천 정보를 제공합니다. 본 약관은 사용자에게
          무료로 제공되는 본 서비스의 이용 조건을 규정합니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>2. 데이터 정확성 / 책임 한정</h2>
        <p>본 서비스가 제공하는 모든 통계, 점수, 예측 정보는 참고용입니다. 데이터 정확성을
          보장하지 않으며, 본 서비스 사용으로 발생하는 직간접적 손해에 대해 책임지지 않습니다.
          AI Score, 티어 예측, 픽 추천 등은 자체 알고리즘으로 산출된 추정치이며 Riot Games의
          공식 평가가 아닙니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>3. 금지 행위</h2>
        <p>사용자는 다음 행위를 하지 않아야 합니다:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>본 서비스 또는 Riot Games API에 대한 자동화된 대량 요청(스크래핑, 봇).</li>
          <li>본 서비스에서 제공하는 데이터를 무단으로 재배포·판매하거나 별도 API로 제공.</li>
          <li>도박, 베팅, 승부 예측 거래 등 게임 결과를 이용한 금전적 행위.</li>
          <li>다른 사용자의 계정 정보를 부정 사용하거나, 본인이 아닌 타인의 데이터 삭제 요청 위장.</li>
          <li>League of Legends 클라이언트(LCU) 후킹, 실시간 챔피언 선택 화면 자동 인식 등
              Riot Developer Policy가 금지하는 in-client 통합.</li>
          <li>본 서비스 인프라에 대한 보안 위협 행위(취약점 스캔, DoS 등).</li>
        </ul>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>4. 사용자 의무</h2>
        <ul style={{ paddingLeft: 18 }}>
          <li>본 약관과 함께
              <a href="https://developer.riotgames.com/policies/general" target="_blank" rel="noopener noreferrer"> Riot Games Developer Policy</a>를
              준수해야 합니다. 두 약관이 충돌하는 경우 Riot Developer Policy가 우선합니다.</li>
          <li>본 서비스의 정보를 게임 내에서 실시간으로 활용해 부정한 경쟁 우위를 얻지 않습니다.</li>
        </ul>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>5. 개인정보 처리</h2>
        <p>본 서비스의 개인정보 수집, 보존, 삭제 정책은 <a href="/privacy">개인정보처리방침</a>에
          별도로 명시합니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>6. 약관 변경</h2>
        <p>본 약관은 변경될 수 있으며, 변경 사항은 본 페이지를 통해 공지합니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>7. Riot Games 비후원</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          TeamLOL isn't endorsed by Riot Games and doesn't reflect the views or opinions of
          Riot Games or anyone officially involved in producing or managing Riot Games properties.
          Riot Games, and all associated properties are trademarks or registered trademarks of
          Riot Games, Inc.
        </p>
      </div>
    </main>
  );
}
