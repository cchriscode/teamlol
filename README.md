# LoL 전적검색 사이트 — Handoff Package

> Claude Code에 작업을 넘기기 위해 정리된 프로젝트 패키지입니다.

## 무엇이 들어있나

```
handoff/
├── README.md          ← 지금 보는 파일 (전체 가이드)
├── CLAUDE.md          ← Claude Code용 작업 가이드 (먼저 읽을 것)
├── PRD.md             ← Product Requirements Document (왜 만드는가)
├── SPEC.md            ← 기능 상세 명세 (무엇을 만드는가)
└── prototype/         ← UI 프로토타입 — HTML/CSS 디자인 레퍼런스
    ├── styles.css     ← 디자인 토큰 (색상, 타이포)
    ├── index.html     ← 홈 페이지
    ├── summoner.html  ← 소환사 페이지 (개요 탭)
    ├── champions.html ← 챔피언 티어표
    └── live-game.html ← 라이브 게임 페이지
```

## 어떻게 사용하나

### 1. 프로토타입 미리보기
브라우저로 `prototype/index.html`을 열면 전체 디자인 흐름을 볼 수 있습니다. 4개 페이지가 헤더 네비게이션으로 연결되어 있어요.

### 2. Claude Code에 넘기기
이 폴더 전체를 Claude Code 작업 디렉토리에 두고, 다음과 같이 시작하세요:

```
/handoff/CLAUDE.md를 읽고 프로젝트를 시작해줘.
권장 기술 스택을 확인하고, 합의 필요한 항목을 나에게 물어봐.
```

Claude Code는 `CLAUDE.md`의 지침에 따라 PRD → SPEC → prototype 순으로 읽고, 환경 세팅부터 합의하면서 작업을 진행합니다.

### 3. 문서 수정
프로젝트가 진행되면서 결정 사항이 생기면 해당 문서에 즉시 반영합니다:
- 비전·범위 변경 → `PRD.md`
- 기능 추가·수정 → `SPEC.md`
- 디자인 변경 → `prototype/` 의 HTML/CSS
- 작업 방식 변경 → `CLAUDE.md`

## 프로젝트 개요 (한 페이지 요약)

**목표**: LoL(리그 오브 레전드) 솔로랭크 유저를 위한 전적검색 + 챔프 셀렉트 픽 추천 서비스

**경쟁자**: op.gg, deeplol.gg, lol.ps

**차별화**: 챔프 셀렉트 단계에서 사용 가능한 픽 추천 기능 (Phase 4)

**대상 유저**: 한국 솔로랭크 다이아+ 유저 (1차)

**기술 스택 권장**: Next.js + Node.js + PostgreSQL + Redis + Riot Games API

**일정**:
- M1~M2: MVP (검색, 소환사 페이지, 라이브 게임)
- M3: 챔피언 통계
- M4: AI Score, 차별화 기능
- M5: 베타
- M6: 정식 출시
- M9: 픽 추천 기능

**비용 추정**: 첫 1년 약 15만원 (도메인 + VPS)

**제약**:
- Riot API는 무료지만 Production 키 신청 필요 (~2주 심사)
- 과거 매치 데이터는 약 2년 한계, 첫날부터 직접 수집 필요
- 그라데이션·이모지 사용 금지 (디자인 결정)
- 다크 모드가 디폴트

## 디자인 원칙 요약

1. **다크 + 솔리드 컬러** — 그라데이션·블러·글로우 없음
2. **정보 밀도 높게** — op.gg보다 deeplol/lol.ps 스타일
3. **Pretendard 폰트** — 한국어 친화 모던 sans-serif
4. **클릭 수 최소화** — 호버 팝오버, 매치 펼치기
5. **숫자는 tabular-nums** — 정렬 핵심
6. **한국 우선, 글로벌 가능** — i18n 구조 처음부터

## 다음 단계

Claude Code에 이 폴더를 전달하기 전에 다음을 확정하면 좋습니다:

- [ ] 프로젝트 이름 + 도메인
- [ ] Riot API Dev key 발급
- [ ] 호스팅 방식 (Vercel? VPS?)
- [ ] 본인 개발 환경 (Node.js 버전 등)
- [ ] Git 레포지토리 생성

---

질문은 `CLAUDE.md` 안의 가이드를 먼저 확인하세요. 그래도 모호한 부분이 있으면 사용자에게 직접 물어보세요.
