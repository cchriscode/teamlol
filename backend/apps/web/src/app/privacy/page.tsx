import { DeleteDataForm } from './delete-data-form';

export const metadata = { title: '개인정보처리방침 — TeamLOL' };

const CONTACT_EMAIL = 'bj1304@naver.com';

export default function PrivacyPage() {
  return (
    <main className="page">
      <h1 className="page-title">개인정보처리방침</h1>
      <div className="card" style={{ padding: 24, marginTop: 16, lineHeight: 1.8, fontSize: 13 }}>
        <p className="text-tertiary" style={{ fontSize: 11, marginBottom: 16 }}>
          최종 업데이트 2026-05-19
        </p>

        <h2 style={{ fontSize: 16, marginTop: 8, marginBottom: 8 }}>1. 수집하는 정보</h2>
        <ul style={{ paddingLeft: 18 }}>
          <li><strong>공개 Riot 데이터</strong>: Riot ID, PUUID, 소환사 레벨/아이콘, 랭크 정보,
              매치 메타데이터 및 참가자 통계, 챔피언 마스터리.
              Riot Games Developer API를 통해 공식적으로 제공되는 공개 데이터만 가져옵니다.</li>
          <li><strong>검색 로그</strong>: 검색된 Riot ID와 검색 시각. 인기 검색어 집계용.
              IP는 SHA-256 해시 처리 후 저장합니다.</li>
          <li><strong>쿠키/로컬스토리지</strong>: 사용자가 선택한 서버(KR/NA 등) 선호도 저장. 추적 쿠키 사용 안 함.</li>
        </ul>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>2. 보존 기간</h2>
        <ul style={{ paddingLeft: 18 }}>
          <li>매치 데이터: 영구 보존 (Riot 정책상 매치는 종료 후 불변).</li>
          <li>소환사 프로필/랭크: 최대 24시간 캐시, 이후 Riot API에서 자동 갱신.</li>
          <li>검색 로그(해시된 IP 포함): 7일 후 자동 폐기.</li>
        </ul>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>3. 제3자 제공</h2>
        <p>본 서비스는 수집한 데이터를 외부에 판매하거나 제공하지 않습니다. 데이터의 원천은
          Riot Games이며, 표시되는 모든 게임 정보는 Riot Games Developer API를 통해 가져옵니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>4. 사용자의 권리 (데이터 삭제 요청)</h2>
        <p>본인의 Riot 계정 관련 데이터에 대해 다음 권리를 보유합니다:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li><strong>열람</strong>: 본 서비스가 저장 중인 본인 관련 데이터 확인 요청.</li>
          <li><strong>삭제 (잊혀질 권리, GDPR Article 17)</strong>: 본인 PUUID에 연결된 모든 데이터 삭제 요청.
              요청 접수 후 영업일 기준 7일 내 처리하며, 처리 완료 시 해당 계정은 자동 수집 차단 목록에 등록되어
              이후 다시 수집되지 않습니다.</li>
          <li>매치에 포함된 다른 9명의 데이터는 보존되지만, 본인을 가리키는 통계 행은 모두 제거됩니다.</li>
        </ul>
        <p>요청 방법: <a href="/privacy#delete">하단 데이터 삭제 폼</a> 또는
          이메일 <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>로
          Riot ID(이름#태그)를 명시하여 발송.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>5. 보안</h2>
        <p>모든 통신은 HTTPS로 암호화되며, 데이터베이스는 외부 접근이 차단된 사설망에서 운영됩니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>6. Riot Games 비후원</h2>
        <p>TeamLOL은 Riot Games, Inc.의 후원, 보증 또는 운영을 받지 않으며 공식 서비스가 아닙니다.
          League of Legends 및 관련 로고/이미지는 Riot Games의 상표입니다.</p>

        <h2 style={{ fontSize: 16, marginTop: 16, marginBottom: 8 }}>7. 문의</h2>
        <p>본 정책 관련 문의 또는 데이터 삭제 요청: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p>

        <h2 id="delete" style={{ fontSize: 16, marginTop: 24, marginBottom: 8 }}>데이터 삭제 요청</h2>
        <p className="text-tertiary" style={{ fontSize: 12 }}>
          본인 Riot ID 입력 → 요청 접수 → 워커가 24시간 내 처리.
          삭제 후 동일 PUUID는 자동 수집 차단됩니다.
        </p>
        <DeleteDataForm />
      </div>
    </main>
  );
}

