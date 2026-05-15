# CLAUDE.md — Claude Code 작업 가이드

> 이 문서는 Claude Code가 본 프로젝트를 시작할 때 가장 먼저 읽어야 하는 파일입니다.

---

## 0. 빠른 시작 (TL;DR)

당신은 LoL(리그 오브 레전드) 전적검색 사이트를 처음부터 구축합니다. 다음 순서로 작업하세요:

1. **모든 문서를 읽으세요** — `PRD.md` → `SPEC.md` → `prototype/` 디렉토리의 HTML 4개
2. **프로토타입의 디자인을 그대로 따르세요** — 색상, 타이포, 레이아웃 모두 `prototype/styles.css` 기준
3. **Phase 1 MVP만 먼저 구현하세요** — 다른 Phase는 사용자가 명시적으로 요청할 때까지 보류
4. **기술 스택은 아래 권장안을 따르되, 사용자와 합의 후 시작하세요**
5. **Riot API 키는 사용자가 직접 발급/관리하므로 환경변수로만 다루세요**

---

## 1. 이 폴더의 구조

```
handoff/
├── README.md             ← 프로젝트 개요
├── CLAUDE.md             ← 이 파일 (작업 가이드)
├── PRD.md                ← 비전, 목표, 사용자, 차별화
├── SPEC.md               ← 페이지·기능별 상세 명세 (F-101 ~ F-705)
└── prototype/            ← 디자인 레퍼런스 (HTML/CSS)
    ├── styles.css        ← 디자인 토큰 + 공통 스타일
    ├── index.html        ← 홈
    ├── summoner.html     ← 소환사 페이지 (개요 탭)
    ├── champions.html    ← 챔피언 티어표
    └── live-game.html    ← 라이브 게임 페이지
```

문서 우선순위: **PRD.md (왜)** → **SPEC.md (무엇)** → **prototype (어떻게 보여야 하는가)** → **CLAUDE.md (어떻게 만드는가)**

---

## 2. 기술 스택 권장안

사용자와 시작 전에 합의하세요. 권장은 다음과 같습니다:

### Frontend
- **Next.js 15+** (App Router) — SEO 필수, SSR 기본
- **TypeScript** — strict mode
- **Tailwind CSS** + **shadcn/ui** — 디자인 토큰은 `prototype/styles.css`의 CSS 변수와 1:1 매핑
- **TanStack Query** — 서버 상태 캐싱 (Riot API 호출 결과)
- **Zustand** 또는 React Context — 클라이언트 전역 상태 (리전, 다크모드 등)
- **Recharts** 또는 **visx** — 매치 상세 그래프용
- **Pretendard** — 한국어 폰트 (이미 prototype에서 CDN 사용 중)

### Backend
- **Node.js + Fastify** 또는 **NestJS** — 빠른 개발과 TypeScript 일관성
- 대안: **Go (Fiber/Echo)** — 데이터 수집 워커 성능에 유리
- **PostgreSQL** — 메인 DB
- **Redis** — 캐싱, 레이트리밋 토큰 버킷, 큐
- **BullMQ** — 매치 수집 워커 (Redis 기반 큐)

### Infrastructure
- **Docker Compose** — 로컬 개발 환경
- **Cloudflare** — CDN + DDoS 방어 (무료)
- **Vercel** 또는 **VPS (Vultr/Hetzner)** — Next.js 호스팅
- **자체 서버 또는 AWS RDS** — PostgreSQL

### 모노레포 권장
```
/apps
  /web        Next.js 프론트
  /api        백엔드 API 서버
  /worker     데이터 수집 워커
/packages
  /ui         공유 UI 컴포넌트
  /db         Prisma/Drizzle 스키마
  /riot       Riot API 클라이언트 (레이트리밋 포함)
  /shared     공유 타입/유틸
```

---

## 3. 디자인 시스템 — `prototype/styles.css` 기준

### 3.1 색상 토큰 (CSS Variables)

`prototype/styles.css`의 `:root` 블록을 그대로 가져오세요. 핵심:

```css
/* Surfaces */
--bg-base: #0B0E14;           /* 페이지 배경 */
--bg-surface: #131720;         /* 카드 배경 */
--bg-elevated: #1A1F2C;        /* 호버, 부각된 요소 */
--bg-input: #0F131C;           /* 입력 필드 */

/* Borders */
--border-subtle: #1F2433;      /* 기본 카드 보더 */
--border-default: #2A3142;     /* 입력 필드 보더 */
--border-strong: #3A4358;      /* 호버 시 보더 */

/* Text */
--text-primary: #E8EAED;
--text-secondary: #9AA0A6;
--text-tertiary: #5F6571;
--text-quaternary: #41464F;

/* Semantic */
--color-win: #4A90E2;          /* 블루팀, 승리 */
--color-loss: #E25C5C;         /* 레드팀, 패배 */
--color-positive: #5DC994;     /* 변동 상승, 좋은 지표 */
--color-warning: #E8B339;      /* 주의 */
```

### 3.2 디자인 원칙 (사용자가 명시한 제약)

다음 규칙은 **절대 어기지 마세요**. 사용자가 명시한 디자인 철학입니다.

- **그라데이션 사용 금지** — `linear-gradient`, `radial-gradient`, `conic-gradient` 모두 금지
  - 예외 없음. 데이터 시각화도 SVG `stroke-dasharray` 등으로 대체
- **이모지 사용 금지** — UI 어디에도 이모지 넣지 말 것
  - 아이콘이 필요하면 `lucide-react` 또는 SVG 사용
- **다크 모드가 기본** — 라이트 모드는 추후 옵션
- **솔리드 컬러 + 1px 보더** — 그림자, 블러, 글로우 효과 사용 안 함

### 3.3 타이포그래피

```css
font-family: 'Pretendard Variable', Pretendard, -apple-system, sans-serif;
font-feature-settings: 'tnum' on, 'lnum' on;  /* 숫자 정렬 핵심 */
```

- 본문: 13px / 1.5
- 헤더: 16~28px / `font-weight: 500~600`
- 숫자: 항상 `font-feature-settings: 'tnum' on` 적용 (KDA, 승률 정렬용)
- 숫자는 이상한 소수점 안 나오게 항상 `Math.round()` / `.toFixed()` 거치기

### 3.4 컴포넌트 패턴

prototype 코드를 React 컴포넌트로 직접 옮기세요. 예:

| Prototype 클래스 | React 컴포넌트 |
|---|---|
| `.match-card` | `<MatchCard win={true} />` |
| `.player-card.blue` | `<PlayerCard team="blue" />` |
| `.tier-table-row` | `<TierTableRow champion={...} />` |
| `.rank-card` | `<RankCard queue="solo" />` |
| `.champ-icon` | `<ChampionIcon size={32} championKey="aatrox" />` |

---

## 4. Riot API 통합 가이드

### 4.1 라우팅 (반드시 숙지)

```
Platform Routes (서버별):  kr / na1 / euw1 / jp1 / br1 / la1 / la2 / oc1 / tr1 / ru / vn2 / tw2 / sg2 / ph2 / th2
Regional Routes (광역):    asia / americas / europe / sea
```

| API | 라우팅 |
|---|---|
| ACCOUNT-V1 | regional (asia, americas, europe) |
| SUMMONER-V4 | platform (kr 등) |
| LEAGUE-V4 | platform |
| MATCH-V5 | regional |
| SPECTATOR-V5 | platform |
| CHAMPION-MASTERY-V4 | platform |

KR 서버 유저는 platform=`kr`, regional=`asia` 조합.

### 4.2 검색 플로우 (가장 중요)

```typescript
// 1. Riot ID → PUUID
const account = await riot.account.byRiotId({
  region: 'asia',
  gameName: '이름',
  tagLine: 'KR1'
});

// 2. PUUID → Summoner 프로필
const summoner = await riot.summoner.byPuuid({
  platform: 'kr',
  puuid: account.puuid
});

// 3. PUUID → 랭크
const ranks = await riot.league.entriesByPuuid({
  platform: 'kr',
  puuid: account.puuid
});

// 4. PUUID → 매치 ID 리스트 (보통 20개)
const matchIds = await riot.match.idsByPuuid({
  region: 'asia',
  puuid: account.puuid,
  count: 20
});

// 5. 각 매치 ID → 매치 상세 (병렬)
const matches = await Promise.all(
  matchIds.map(id => riot.match.byId({ region: 'asia', matchId: id }))
);
```

→ 한 번 검색에 **24회 호출**. 레이트리밋 관리 필수.

### 4.3 레이트리밋 처리

- 응답 헤더 `X-App-Rate-Limit-Count`, `X-Method-Rate-Limit-Count` 파싱
- 429 응답 시 `Retry-After` 헤더 따라 대기 후 재시도
- 클라이언트 측에서 토큰 버킷 알고리즘으로 사전 통제 (Bottleneck 라이브러리 추천)
- 캐싱이 핵심: 동일 매치 ID는 한 번만 가져와서 DB 저장

### 4.4 데이터 캐싱 전략

| 데이터 | 캐시 만료 | 비고 |
|---|---|---|
| Account (PUUID) | 영구 | 변경 사항 거의 없음 |
| Summoner 프로필 | 5분 | 레벨/아이콘 변경 |
| 랭크 정보 | 5분 | 게임 종료 후 갱신 |
| 매치 상세 | 영구 | 한번 끝난 게임은 안 변함 |
| 매치 ID 리스트 (by PUUID) | 2분 | 새 매치 감지용 |
| 라이브 게임 | 30초 | 폴링용 |
| 챔피언 통계 (집계) | 1시간 | 워커가 주기 갱신 |

### 4.5 API 키 관리

- **절대 클라이언트(브라우저)로 노출하지 말 것**
- 환경변수 `RIOT_API_KEY` 사용
- Dev key (24시간 만료) → Personal key (1년) → Production key (1년) 순으로 발급
- 사용자가 직접 https://developer.riotgames.com 에서 발급/갱신

---

## 5. Data Dragon (정적 데이터)

이미지·챔프 이름·아이템 정보 등은 ddragon CDN에서 직접 가져옵니다.

```
https://ddragon.leagueoflegends.com/cdn/{version}/data/ko_KR/champion.json
https://ddragon.leagueoflegends.com/cdn/{version}/img/champion/{name}.png
https://ddragon.leagueoflegends.com/cdn/{version}/img/item/{itemId}.png
https://ddragon.leagueoflegends.com/cdn/{version}/img/profileicon/{id}.png
```

- 패치 버전은 `https://ddragon.leagueoflegends.com/api/versions.json` 첫 항목
- 한국어는 `ko_KR`
- 자체 CDN으로 프록시할 필요 없음. 직접 ddragon URL 사용

이미지 컴포넌트 예시:
```tsx
function ChampionIcon({ championKey, size = 48 }: Props) {
  const version = useDataDragonVersion();
  return (
    <img
      src={`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${championKey}.png`}
      width={size}
      height={size}
      className="champ-icon"
      alt=""
    />
  );
}
```

---

## 6. DB 스키마 가이드 (간단)

상세는 별도 문서가 아직 없으니 다음 패턴을 따르세요:

```sql
-- 핵심 테이블
accounts            (puuid PK, game_name, tag_line, region, updated_at)
summoners           (puuid PK, profile_icon_id, summoner_level, last_revision_date)
league_entries      (puuid+queue_type PK, tier, rank, lp, wins, losses, ...)
matches             (match_id PK, game_version, queue_id, game_creation, game_duration, ...)
match_participants  (match_id+puuid PK, champion_id, team_id, win, kills, deaths, assists, items[], ...)
match_timelines     (match_id PK, data JSONB)  -- 용량 큼, 별도 테이블

-- 집계 테이블 (워커가 주기 갱신)
champion_stats_daily      (champion_id+lane+tier+date PK, picks, wins, bans, ...)
champion_matchups_daily   (champion_id+enemy_id+lane+tier+date PK, ...)

-- 자체 데이터
search_logs        (id PK, riot_id, region, searched_at, ip_hash)
```

매치 원본 JSON은 `matches.raw_data JSONB`로 저장해두면 추후 새 컬럼 추출 시 유리.

---

## 7. Phase 1 MVP 작업 우선순위

`SPEC.md`의 Phase 1 항목만 먼저 만드세요. 우선순위 순:

### 7.1 백엔드 우선
1. Riot API 클라이언트 (레이트리밋 + 캐싱 포함)
2. DB 스키마 + 마이그레이션
3. ACCOUNT-V1, SUMMONER-V4, LEAGUE-V4 통합 → 소환사 검색 API
4. MATCH-V5 통합 → 매치 리스트 API
5. SPECTATOR-V5 통합 → 라이브 게임 API

### 7.2 프론트엔드
1. 글로벌 레이아웃 (헤더, 푸터)
2. 홈 페이지 (검색만)
3. 소환사 페이지 — 개요 탭 (프로필 + 매치 리스트)
4. 매치 카드 컴포넌트 (펼치기는 Phase 2로 미룸)
5. 라이브 게임 페이지

### 7.3 Phase 1에서 의도적으로 빼는 것들

- AI Score (알고리즘 미정, Phase 3)
- 듀오/세션 묶음 (Phase 3)
- 챔피언 티어표 (Phase 2)
- 챔피언 상세 (Phase 2)
- 멀티서치, 랭킹 (Phase 3)
- 시즌 셀렉터 (Phase 2)
- 매치 상세 그래프 (Phase 2)

이 항목들은 사용자가 명시적으로 요청할 때까지 손대지 말 것.

---

## 8. 코딩 컨벤션

### 8.1 일반
- TypeScript strict 모드
- ESLint + Prettier (Next.js 기본값)
- Conventional Commits (`feat:`, `fix:`, `chore:` 등)
- 파일명: `kebab-case.ts`, 컴포넌트는 `PascalCase.tsx`

### 8.2 Next.js
- App Router 사용 (Pages Router 아님)
- 서버 컴포넌트 우선, 인터랙티브 부분만 `'use client'`
- 메타 태그는 `generateMetadata` 함수로 동적 생성 (소환사명 등)
- `revalidate` 활용 — ISR로 챔프 페이지는 1시간 단위 갱신

### 8.3 컴포넌트
- 파일당 컴포넌트 하나
- Props는 인터페이스로 정의 (`interface MatchCardProps {...}`)
- 비동기 데이터는 React Query로 분리, 컴포넌트는 데이터를 props로 받기만
- 큰 컴포넌트는 `_components` 하위 폴더로 분리

### 8.4 디자인 토큰
- **하드코딩 금지** — 모든 색상은 CSS 변수 또는 Tailwind 토큰
- Tailwind config에 prototype의 CSS 변수를 매핑:
  ```js
  // tailwind.config.ts
  theme: {
    extend: {
      colors: {
        'bg-base': 'var(--bg-base)',
        'bg-surface': 'var(--bg-surface)',
        // ...
        win: 'var(--color-win)',
        loss: 'var(--color-loss)',
      }
    }
  }
  ```

### 8.5 숫자 표시
- 큰 숫자는 `toLocaleString('ko-KR')`로 천 단위 콤마
- 퍼센트는 `.toFixed(1) + '%'` (소수 1자리)
- KDA는 `.toFixed(2)`
- 시간은 `Intl.RelativeTimeFormat('ko-KR')` 사용 ("3분 전")

---

## 9. 자주 하는 실수 (Anti-patterns)

### 피해야 할 것들
- ❌ Riot API 키를 클라이언트(브라우저)로 노출
- ❌ 매치 상세를 매번 Riot API에 요청 (DB에 영구 캐싱해야 함)
- ❌ ddragon 이미지 URL을 자체 서버로 프록시 (불필요)
- ❌ `summonerName` 사용 (deprecated, Riot ID 사용)
- ❌ summonerId 기반 LEAGUE-V4 호출 (PUUID 기반으로 변경됨)
- ❌ 그라데이션·이모지 사용 (사용자가 명시적으로 금지)
- ❌ 단일 매치 ID를 여러 번 호출 (idempotent하게 캐싱)
- ❌ Phase 1 범위 밖 기능을 미리 만들기

### 해야 할 것들
- ✅ 모든 API 호출에 try/catch + 의미 있는 에러 메시지
- ✅ 로딩 상태에 스켈레톤 UI 표시
- ✅ 데이터 없을 때(검색 결과 없음 등) 명확한 빈 상태 UI
- ✅ 모바일 반응형은 처음부터 고려 (Tailwind breakpoint)
- ✅ 한국어 텍스트 모두 i18n 가능하도록 분리 (next-intl 등)
- ✅ 데이터 변환 로직은 백엔드에서 (프론트는 표시만)

---

## 10. 사용자와 합의 필요한 항목

작업 시작 전 사용자에게 다음을 명확히 확인하세요:

1. **프로젝트 이름 + 도메인** (현재 미정)
2. **기술 스택 최종 확정** (위 권장안 vs 다른 선호?)
3. **모노레포 vs 멀티레포**
4. **호스팅 방식** (Vercel? 자체 VPS?)
5. **Riot API 키 발급 상태** (Dev key 보유 여부)
6. **로컬 개발 PC 사양** (DB 띄우고 워커 돌릴 수 있는지)

---

## 11. 작업 흐름 (Workflow)

### 첫 세션
1. 사용자에게 인사하고 본 프로젝트 이해도 확인
2. 위 "사용자와 합의 필요한 항목" 11개 질문
3. 합의된 스택으로 모노레포 초기 세팅 (Docker Compose 포함)
4. README.md, .gitignore, 환경변수 템플릿(.env.example) 생성
5. 첫 커밋 (`chore: initial monorepo setup`)

### 두 번째 세션 이후
1. 진행 중인 Phase 1 항목 중 하나 선택 (사용자와 합의)
2. 한 번에 한 기능만 (`feat: implement summoner search`)
3. 디자인은 prototype 그대로 React 컴포넌트화
4. 테스트 가능한 형태로 구현 (적어도 하나의 실제 Riot ID로 동작 확인)

---

## 12. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v0.1 | 2026-05-10 | 초안 작성 |

---

**중요**: 이 문서, `PRD.md`, `SPEC.md`, `prototype/`은 살아있는 문서입니다. 작업 중 합의된 변경사항은 즉시 해당 문서에 반영하세요.
