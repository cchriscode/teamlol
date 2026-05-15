# 픽 추천 시스템 — 상세 명세 (Pick Recommend Spec)

| 항목 | 내용 |
|---|---|
| 문서 버전 | v0.1 (초안) |
| 작성일 | 2026-05-11 |
| 상태 | 설계 합의 완료 — 구현 전 |
| 관련 문서 | `PRD.md` §6 Phase 4, `SPEC.md` §5.7 F-7xx |
| Phase | 4.0 (디자인) → 4.7 (LCU 연동) |

---

## 1. 개요

### 1.1 목적

LoL 챔피언 셀렉트 단계에서 양 팀의 픽·밴 정보, 픽 순서, 본인 라인을 입력받아 **이 상황에서 우리 팀에 최적인 챔프 후보 15개**를 점수와 함께 추천한다.

기존 op.gg / deeplol / lolalytics는 "라인별 메타 챔프" 또는 "1대1 카운터"만 보여주는 반면, 본 시스템은 **드래프트 컨텍스트 전체** (픽 순서, 컴포 균형, 밴 시그널, 팀원 의도)를 종합한다. PRD D1의 핵심 차별화.

### 1.2 본 문서가 다루는 것

- 입력 데이터 구조 (DraftState)
- 출력 데이터 구조 (RecommendResult)
- 점수 알고리즘 (컴포넌트 6개 + 가중치)
- 컴포지션 분석 규칙
- 추천 이유 텍스트 생성 규칙
- 밴 처리 정책
- 데이터 의존성 (큐레이션 + 워커)
- UI 변경 사항 (`pick-recommend.html`)
- 단계별 작업 분해 (Phase 4.0 ~ 4.7)
- LCU 자동 입력을 위한 미래 인터페이스

### 1.3 본 문서가 다루지 않는 것

- 매치업/시너지 매트릭스 워커 구현 상세 (별도 명세)
- 데스크톱 앱 LCU 연동 상세 (Phase 4.7 별도 명세)
- 화면 인식(F-705) — Phase 5+

---

## 2. 사용자 시나리오

### 2.1 시나리오 A — 솔랭 미드 유저, 4픽 (후픽)

> 본인이 4픽이고, 우리팀은 1탑·2정·3원이 픽 완료, 적팀은 1탑·2정·3미가 픽 완료. 본인은 미드. 적 미드는 야스오. 

**기대 동작**: 야스오 카운터 가중 + 우리팀 부족한 컴포(예: AP 부족) 보완 + 메타 강자 위주로 추천.

### 2.2 시나리오 B — 솔랭 탑 유저, 1픽 (선픽)

> 본인이 1픽 탑. 정보 0. 팀원이 의도 표시도 없음.

**기대 동작**: 메타 점수 강한 + 카운터 당하기 어려운 안전 픽 (말파이트, 잭스 등) 위주. 카운터·시너지·컴포 가중치 0.

### 2.3 시나리오 C — 1픽이지만 팀원 의도 있음

> 본인이 1픽 미드. 우리팀 다른 4명이 "탑 잭스 / 정 비에고 / 원 케이틀린 / 서 노틸러스"를 의도 표시.

**기대 동작**: 메타 점수 + 위 4챔프와 시너지 좋고 부족한 컴포 채우는 챔프 가중. 의도는 0.5 가중치.

### 2.4 시나리오 D — 자동 감지 (Phase 4.7)

> LCU 데스크톱 앱이 픽창 진입 시 자동으로 DraftState 생성. 사용자는 결과만 본다.

**기대 동작**: 폴링 1초 간격, 픽창 상태 변화 시 추천 즉시 갱신.

---

## 3. 입력 — DraftState

```typescript
type Lane = 'top' | 'jungle' | 'mid' | 'adc' | 'support';
type ChampionKey = string; // ddragon key, e.g., "Aatrox"
type TierBracket = 'emerald+' | 'diamond+' | 'master+' | 'gm+' | 'challenger+';

type SlotState = {
  pickOrder: 1 | 2 | 3 | 4 | 5;       // 팀 내 픽 순서
  champion?: ChampionKey;              // 미정이면 undefined
  lane?: Lane;                         // 미정이면 undefined
  status: 'confirmed' | 'intent' | 'empty';
  isMine?: boolean;                    // 본인 슬롯 여부 (정확히 1개)
};

type DraftState = {
  myTeam: [SlotState, SlotState, SlotState, SlotState, SlotState];
  enemyTeam: [SlotState, SlotState, SlotState, SlotState, SlotState];
  myBans: ChampionKey[];               // 0~5
  enemyBans: ChampionKey[];            // 0~5
  patch: string;                       // "26.09"
  tierBracket: TierBracket;            // 데이터 집계 기준 티어
  myCurrentTier?: string;              // 자동 bracket 상향 계산용 (선택)
  pickPhaseGlobal: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10; // 전체 1~10픽 중 어디
};
```

### 3.1 픽 순서 (롤 공식 룰)

```
1픽 B1 → 2픽 R1 → 3픽 R2 → 4픽 B2 → 5픽 B3
6픽 R3 → 7픽 R4 → 8픽 B4 → 9픽 B5 → 10픽 R5
```

`pickPhaseGlobal`은 위 1~10 중 본인 차례.

### 3.2 SlotState.status 의미

| status | 의미 | 알고리즘 처리 |
|---|---|---|
| `confirmed` | 락인 완료 | 시너지·컴포 1.0 가중 |
| `intent` | 팀원이 "할게요" 의사 표시 | 시너지·컴포 0.5 가중 |
| `empty` | 정보 없음 | 무시 |

### 3.3 tierBracket 자동 결정

`myCurrentTier`가 주어지면 다음 규칙으로 자동 상향:

```
emerald 이하 → 'emerald+'
diamond      → 'diamond+'
master       → 'master+'
grandmaster  → 'gm+'
challenger   → 'challenger+'
```

사용자가 명시적으로 `tierBracket`을 바꾸면 자동 결정 무시.

---

## 4. 출력 — RecommendResult

```typescript
type RecommendResult = {
  candidates: CandidateCard[];        // 정확히 15개, 점수 내림차순
  composition: CompositionAnalysis;   // 우리팀 현재 컴포
  banSuggestions: BanSuggestion[];    // 추천 밴 10개 (별도 알고리즘)
  meta: {
    patch: string;
    tierBracket: TierBracket;
    sampleStaleness: 'fresh' | 'low_sample' | 'previous_patch_blend';
    computedAt: string;               // ISO timestamp
  };
};

type CandidateCard = {
  champion: ChampionKey;
  score: number;                      // 0~100
  breakdown: {
    M: number;  // meta
    C: number;  // counter
    S: number;  // synergy
    B: number;  // balance
    R: number;  // first-pick risk (negative contribution)
    I: number;  // ally intent
  };
  reasonText: string;                 // 자연어 1~2문장
  reasonTags: string[];               // 3개 이내 짧은 태그
  masteryInfo: {
    difficulty: 'easy' | 'medium' | 'hard' | 'insane';
    seasonGames: number;
    message: string;                  // "쉬운 챔프 · 처음 픽 OK" 등
  };
  isBanned: boolean;                  // 밴된 챔프 (회색 표시)
  bannedBy?: 'us' | 'enemy';          // 밴 정보 출처
};

type CompositionAnalysis = {
  adShare: number;                    // 0~100
  apShare: number;                    // 0~100
  trueShare: number;                  // 0~100
  hardCcCount: number;                // 합산
  ccTarget: number;                   // 권장 (보통 2, engage 컴포 3)
  tankCount: number;
  bruiserCount: number;
  engageType: 'hard' | 'soft' | 'pick' | 'none';
  hasEngage: boolean;
  waveClear: number;                  // 0~15 합산
  scaling: { early: number; mid: number; late: number }; // 명수
  archetype: 'engage' | 'poke' | 'pick' | 'protect' | 'split' | 'unknown';
  archetypeConfidence: number;        // 0~1
  gaps: GapDescriptor[];              // 부족 항목 리스트
};

type GapDescriptor = {
  type: 'ap' | 'ad' | 'tank' | 'cc' | 'engage' | 'waveClear' | 'scaling';
  severity: 'low' | 'medium' | 'high';
  message: string;                    // "AP 딜이 22%로 부족 (권장 30%+)"
};

type BanSuggestion = {
  champion: ChampionKey;
  opScore: number;                    // OP 점수 (winrate × pickrate × banrate^0.5)
  reason: string;                     // "패치 1티어 · 우리 컴포에 위협"
};
```

---

## 5. 알고리즘 — 점수 모델

### 5.1 점수 공식

각 후보 챔프 c에 대해:

```
score(c) = w_M·M(c) + w_C·C(c) + w_S·S(c) + w_B·B(c) − w_R·R(c) + w_I·I(c)
```

총점은 0~100으로 정규화 (`min(100, max(0, raw_score))`).

### 5.2 컴포넌트 정의

#### M_meta — 메타 강도

```
M(c) = (winrate(c, lane, bracket) − tier_avg_winrate(lane, bracket)) × 100
       × confidence(N_games(c, lane, bracket))
       + log(pickrate(c) + 1) × 2
       + ban_bonus(c)
```

- `tier_avg_winrate`: 해당 라인·티어의 평균 승률 (보통 50% 근처)
- `confidence(N) = sqrt(N) / sqrt(N + 200)` — 표본 부족 시 점수 약화
- `ban_bonus`: 자주 밴되는 챔프는 위협 챔프 → +5 보너스

#### C_counter — 카운터

```
C(c) = max over enemy of:
  (matchup_winrate(c, enemy) − base_winrate(c)) × 100 × confidence(N) × lane_weight

lane_weight =
  - 같은 라인 적이 픽됨: 1.0
  - 다른 라인 적이 픽됨: 0.2 (전체 평균 매치업)
  - 적이 미픽: 0
```

(lolalytics Δ 방식 차용)

#### S_synergy — 시너지

```
S(c) = Σ over confirmed/intent allies of:
  (pair_winrate(c, ally) − (base_winrate(c) + base_winrate(ally))/2) × 100
  × confidence(N) × intent_weight

intent_weight =
  - status='confirmed': 1.0
  - status='intent': 0.5
  - status='empty': 0
```

#### B_balance — 컴포 균형

```
B(c) = Σ over gap in composition.gaps of:
  if c는 그 gap을 채우는 능력이 있음:
    severity_score(gap) × fit_strength(c, gap)
  else: 0

severity_score:
  - 'high': +20
  - 'medium': +10
  - 'low': +3

fit_strength: 챔프 메타 태그 기반 (예: gap='tank'이면 c.role에 'Tank'/'Bruiser' 포함시 1.0)
```

#### R_risk — 선픽 리스크 (음수 기여)

```
R(c) =
  if pickPhaseGlobal == 1 (B1):
    α × matchup_variance(c, lane, bracket)
    + β × max(0, 50 − worst_matchup_winrate(c, lane, bracket))
  else:
    0

권장 α=0.3, β=2.0
```

블라인드 픽 안전 챔프 큐레이션 리스트(`blindPickSafe: true`)는 R에 -10 보너스.

#### I_intent — 팀원 의도 가중치

```
I(c) = Σ over allies with status='intent' of:
  archetype_match_score(c, ally) × 5

archetype_match_score:
  - c와 ally가 같은 archetype 카테고리: 1.0
  - 보완 관계 (예: poke 팀에 추가 poke vs engage 팀에 protect): 0.5
  - 충돌 (engage 팀에 protect 등): -0.3
```

### 5.3 가중치 테이블 (시나리오별)

| 시나리오 | M | C | S | B | R | I |
|---|---|---|---|---|---|---|
| 1픽 (B1, 정보 0) | **50** | 0 | 5 | 25 | 15 | 5 |
| 1픽 + 의도 있음 | 40 | 0 | 15 | 25 | 10 | **15** |
| 중간 (3~5픽) | 35 | 25 | 20 | 15 | 5 | 5 |
| 후픽 (8~9픽) | 20 | **40** | 20 | 15 | 0 | 5 |
| 후픽 + 같은 라인 적 명확 | 15 | **50** | 15 | 15 | 0 | 5 |

알고리즘이 자동 시나리오 분류:

```js
function pickScenario(state) {
  const phase = state.pickPhaseGlobal;
  const myLane = mySlot(state).lane;
  const sameLaneEnemyPicked = state.enemyTeam.some(s =>
    s.status === 'confirmed' && s.lane === myLane);
  const allyIntents = state.myTeam.filter(s => s.status === 'intent').length;

  if (phase === 1) return allyIntents > 0 ? 'first_with_intent' : 'first_blind';
  if (phase >= 8 && sameLaneEnemyPicked) return 'last_counter_clear';
  if (phase >= 8) return 'last_general';
  return 'middle';
}
```

### 5.4 표본 부족 처리

표본수 N에 따른 처리:

| N (게임수) | 처리 |
|---|---|
| ≥ 1000 | 100% 신뢰 |
| 200 ≤ N < 1000 | confidence 보정 |
| 50 ≤ N < 200 | confidence 보정 + 직전 패치 데이터 가중 혼합 (`weight = max(0.3, 1 − days_since_patch / 14)`) |
| N < 50 | "데이터 부족" 표기 + 점수 ×0.5 |

신규 패치 첫 7일은 모든 챔프에 대해 직전 패치 데이터 50% 혼합.

### 5.5 마스터리는 점수 미반영

`K_mastery` 가중치는 0. 본인 시즌 게임 수와 챔프 난이도는 카드의 정보 영역에만 표시 (§7.2 참조).

이유: 사용자 결정 — 마스터리가 점수에 들어가면 "본인이 잘하는 챔프만 추천"되어 메타 분석 의미가 약해짐. 대신 "이 챔프는 쉬워서 처음 픽해도 OK" 같은 정보로 사용자가 판단.

---

## 6. 컴포지션 분석

### 6.1 입력

`myTeam`의 모든 슬롯 중 status가 `confirmed` 또는 `intent`인 것 (intent는 0.5 가중치).

### 6.2 출력 7개 항목

| 항목 | 계산 | 권장 |
|---|---|---|
| AD/AP/True share | Σ damageType별 챔프 수 / 전체 챔프 수 (정수 비율) | AD 30~70%, 한쪽 20% 미만 시 high gap |
| Hard CC count | Σ ccLevel ≥ 2 챔프의 ccLevel 합 | ≥ 2 (engage 컴포는 ≥3) |
| Tank/Bruiser count | role에 'Tank'/'Bruiser' 포함 챔프 수 | 1~2 |
| Engage type | 우리팀 engageType 중 가장 강한 것 | none이면 high gap |
| Wave clear | Σ waveClear | ≥ 5 |
| Scaling distribution | early/mid/late 챔프 수 | late 0명 + early 다수 = scaling gap |
| Archetype | §6.3 규칙 매칭 | confidence 표시 |

### 6.3 Archetype 감지 규칙

```
engage:   hard engage 챔프 ≥ 2 AND 탱/브루저 ≥ 2
poke:     long-range skillshot 챔프 ≥ 3 (정적 태그 별도)
pick:     pick engage 챔프 ≥ 2 AND 단일 타겟 lockdown
protect:  hyper-carry 챔프 1 + enchanter 1+ peel 챔프 1
split:    split-push 챔프 2+ AND wave clear 합 ≥ 8
unknown:  위 어느 것에도 매칭 안 됨
```

archetypeConfidence는 매칭 챔프 수 비율 (예: 5명 중 4명이 engage 컴포 패턴이면 0.8).

### 6.4 Gaps 출력

GapDescriptor 배열로 부족한 항목 명시. 각 gap은 severity와 자연어 메시지를 가짐:

```js
{
  type: 'ap',
  severity: 'high',
  message: 'AP 딜이 18%로 부족 (권장 30%+)'
}
```

이 gaps가 B_balance 점수 계산의 입력이 됨.

---

## 7. 추천 카드 출력 규칙

### 7.1 점수 분해 막대

각 컴포넌트의 가중 적용된 점수를 막대로 시각화. 음수(R)는 빨강 막대 별도 표시.

### 7.2 마스터리 정보 영역

```
ⓘ {난이도 라벨} · {권장 메시지}
   본인 {게임수}판 사용중
```

난이도 라벨 (Riot ddragon `info.difficulty` 1~10 → 4단계):

| difficulty | 라벨 | 권장 메시지 |
|---|---|---|
| 1~3 | 쉬움 | "처음 픽해도 OK" |
| 4~5 | 중간 | "기본기 있으면 OK" |
| 6~7 | 어려움 | "시즌 20판+ 권장" |
| 8~10 | 매우 어려움 | "시즌 50판+ 권장" |

본인 시즌 게임수 표시 — 권장 게임수 미달 시 노랑 강조 텍스트.

Riot의 difficulty가 부정확한 챔프(이렐리아 5, 리븐 8, 흐웨이 미정 등)는 `difficulty-overrides.json`로 보정 (§8.3).

### 7.3 추천 이유 텍스트

자연어 1~2문장 + 태그 chip 3개 이내. 템플릿 합성:

```js
const REASON_TEMPLATES = [
  // 카운터
  { trigger: c => c.breakdown.C > 15 && counterTarget(c),
    natural: c => `${enemyChampName}을 라인전에서 카운터 (+${delta(c).toFixed(1)}%p)`,
    tag:     c => `#카운터-${enemyChampName}` },

  // 컴포 부족 보완
  { trigger: c => composition.gaps.some(g => g.type === 'ap') && fits(c, 'ap'),
    natural: c => `우리팀 부족한 AP 딜 보완 (현재 ${apShare}%)`,
    tag:     c => `#AP보완` },
  { trigger: c => composition.gaps.some(g => g.type === 'tank') && fits(c, 'tank'),
    natural: c => `프론트라인 보완 (탱커 0명)`,
    tag:     c => `#탱커보완` },
  { trigger: c => composition.gaps.some(g => g.type === 'cc') && fits(c, 'cc'),
    natural: c => `하드 CC 추가 (${ccCount}→${ccCount+1})`,
    tag:     c => `#CC추가` },
  { trigger: c => composition.gaps.some(g => g.type === 'engage') && fits(c, 'engage'),
    natural: c => `이니시 도구 추가`,
    tag:     c => `#이니시추가` },

  // 메타
  { trigger: c => c.breakdown.M > 30 && phase === 1,
    natural: c => `패치 메타 강자 (PS ${ps(c)}, WR ${wr(c)}%)`,
    tag:     c => `#메타1티어` },
  { trigger: c => c.breakdown.M > 30,
    natural: c => `패치 메타 ${psRank(c)}위`,
    tag:     c => `#메타강자` },

  // 선픽 안전
  { trigger: c => phase === 1 && c.breakdown.R < -5,
    natural: c => `선픽 안전 (최악 매치업 ${worstMatchup(c)}%)`,
    tag:     c => `#선픽안전` },

  // archetype
  { trigger: c => composition.archetype !== 'unknown' && matchesArchetype(c),
    natural: c => `${archetypeKr(composition.archetype)} 컴포 강화`,
    tag:     c => `#${archetypeKr(composition.archetype)}` },

  // 밴 시그널
  { trigger: c => enemyBannedOurCounter(c),
    natural: c => `적이 우리 카운터 ${bannedCounterName} 밴 → 안전`,
    tag:     c => `#밴시그널` },

  // 시너지
  { trigger: c => c.breakdown.S > 15,
    natural: c => `${topAllyName}와 시너지 +${sDelta(c)}%p`,
    tag:     c => `#시너지-${topAllyName}` },
];
```

규칙:
1. trigger가 통과하는 모든 템플릿 수집
2. 점수 기여도 순으로 정렬
3. 상위 1개 → natural (자연어 1문장)
4. 상위 2~4개 → tag (3개 이내)

---

## 8. 데이터 의존성

### 8.1 챔프 메타 태그 (정적, 큐레이션)

170챔프 × 7필드. `packages/champion-meta/champion-meta.json`:

```js
{
  "Aatrox": {
    "lanes": ["top"],
    "damageType": "AD",
    "role": ["Bruiser"],
    "ccLevel": 2,
    "engageType": "hard",
    "scaling": "mid",
    "waveClear": 1,
    "blindPickSafe": false,
    "difficulty": 4,
    "archetypeAffinity": ["engage", "split"]
  },
  "Ahri": {
    "lanes": ["mid"],
    "damageType": "AP",
    "role": ["Mage", "Assassin"],
    "ccLevel": 1,
    "engageType": "pick",
    "scaling": "mid",
    "waveClear": 2,
    "blindPickSafe": true,
    "difficulty": 5,
    "archetypeAffinity": ["pick"]
  }
}
```

#### 큐레이션 절차 (Phase 4.1)

1. ddragon `champion.json`에서 자동 추출 가능한 필드 (~70%):
   - `tags` → role 매핑 (Tank/Fighter/Mage/Marksman/Assassin/Support)
   - `info.difficulty` → difficulty 초기값
   - `info.attack`, `info.magic` → damageType 추정
   - `partype` → 마나 타입 (참고)

2. 수동 큐레이션 (~30%):
   - lanes (자주 가는 라인 — 메타 변화 따라 갱신)
   - ccLevel (스킬 설명 분석 + 메타 컨센서스)
   - engageType
   - scaling
   - waveClear
   - blindPickSafe
   - archetypeAffinity

3. 결과는 PR 리뷰 받음 (커뮤니티 의견 수렴 위해).

### 8.2 매치업 매트릭스 (자체 워커)

```
champion_matchups (
  patch text,
  bracket text,
  lane text,
  champion_id int,
  enemy_champion_id int,
  games_played int,
  wins int,
  winrate float,
  updated_at timestamp,
  PRIMARY KEY (patch, bracket, lane, champion_id, enemy_champion_id)
)
```

워커 (BullMQ): 새 매치 수집 시 라인 매치업 추출 → 일별 집계 → 위 테이블 갱신. 패치별 분리.

표본 크기: 다이아+ KR 기준 한 패치당 약 30만 솔랭 게임 → 인기 미드 매치업 평균 약 800 게임 (충분), 비주류 매치업 약 100 게임 (보정 필요).

### 8.3 시너지 매트릭스 (자체 워커)

```
champion_synergies (
  patch text,
  bracket text,
  champion_a_id int,
  champion_b_id int,
  games_played int,
  wins int,
  winrate float,
  updated_at timestamp,
  PRIMARY KEY (patch, bracket, champion_a_id, champion_b_id)
)
```

같은 팀 챔프 페어 단위 집계. 라인 무관 (시너지는 라인 조합과 별개).

### 8.4 difficulty 보정 테이블

`packages/champion-meta/difficulty-overrides.json`:

```js
{
  "Irelia":   { "difficulty": 8, "reason": "Riot=5, 실제 마스터리 곡선 가파름" },
  "Riven":    { "difficulty": 9, "reason": "Riot=8, 콤보 캔슬 숙련도 필수" },
  "Hwei":     { "difficulty": 10, "reason": "ddragon 미정, 스킬 11개 + 콤보 다양" },
  "Akali":    { "difficulty": 8, "reason": "Riot=7, 매치업별 빌드 다양" },
  "Yasuo":    { "difficulty": 10, "reason": "유지" }
}
```

큐레이션은 분기별 검토.

### 8.5 블라인드 픽 안전 챔프 (정적 큐레이션 ~30챔프)

`packages/champion-meta/blind-pick-safe.json`:

```js
{
  "safe": [
    { "champion": "Malphite", "reason": "AP/AD 양면 빌드 가능" },
    { "champion": "Jax",      "reason": "후반 스케일링, 카운터 적음" },
    { "champion": "Amumu",    "reason": "정글 안정" },
    { "champion": "Ahri",     "reason": "기동성, 라인전 약점 작음" }
  ]
}
```

Phase 4.1 시작 시점에 30챔프 큐레이션, 분기별 검토.

### 8.6 데이터 갱신 주기

| 데이터 | 갱신 주기 |
|---|---|
| 매치업 매트릭스 | 일 1회 (집계 잡) |
| 시너지 매트릭스 | 일 1회 |
| 챔프 메타 태그 | 패치 발표 시 (수동, 1~2일 내) |
| difficulty 보정 | 분기 1회 |
| 블라인드 안전 챔프 | 분기 1회 |

---

## 9. 밴 처리 정책

### 9.1 입력 처리

`myBans`, `enemyBans` 둘 다 동일하게 처리:
- 점수 계산은 정상 진행 (밴 챔프도 `score` 산출)
- 결과 카드에 `isBanned: true` + `bannedBy: 'us' | 'enemy'` 표시
- 정렬 순서는 점수 기준 그대로 (밴됐다고 끝으로 밀지 않음)

### 9.2 시각 표시

UI에서 `isBanned: true` 카드:
- `opacity: 0.4`
- 우상단에 "BANNED (적팀)" 또는 "BANNED (우리팀)" 라벨
- 클릭 비활성

### 9.3 밴 시그널 활용

추천 이유 텍스트에 반영:

- 적이 우리 카운터를 밴: "적이 ${counter} 밴 → 우리 메이지 안전"
- 적이 OP 챔프를 밴: 그 챔프와 같은 archetype 챔프 +5 보너스 (간접 효과)
- 우리 밴이 적의 핵심 픽을 막음: "우리가 ${ban} 밴으로 적 ${counterRole} 상대 부담 적음"

### 9.4 밴 추천 (별도 알고리즘, 단순)

```
banScore(c) = winrate(c, bracket) × pickrate(c, bracket) × sqrt(banrate(c, bracket))
```

- 메타 OP 챔프 자동 상위
- 별도 컴포 분석 없음
- 페이지 우측 작은 카드로 TOP 10 표시

이유 텍스트 (간단):

- "패치 1티어 (WR ${wr}%)"
- "픽률 ${pickrate}%"
- "현재 밴률 ${banrate}%"

---

## 10. UI 변경 사항

기존 `pick-recommend.html`을 다음과 같이 개편:

### 10.1 입력 영역 — 픽 순서 슬롯

기존 라인 무차별 5슬롯 → **픽 순서별 5슬롯** (양 팀):

```
픽 순서: B1 → R1 → R2 → B2 → B3 → R3 → R4 → B4 → B5 → R5
                                ↑ 현재 (4픽, B2)

우리팀                            적팀
┌────┬────┬────┬────┬────┐    ┌────┬────┬────┬────┬────┐
│B1픽 │B2픽 │B3픽 │B4픽 │B5픽 │    │R1픽 │R2픽 │R3픽 │R4픽 │R5픽 │
│★★ │ ★  │    │    │    │    │    │    │    │    │    │
│갱플 │야스 │ ?  │ ?  │ ?  │    │이렐 │비에 │아칼 │ ?  │ ?  │
│탑   │미   │    │    │    │    │탑   │정   │미   │    │    │
│확정 │의도 │ -  │ -  │ -  │    │확정 │확정 │확정 │ -  │ -  │
└────┴────┴────┴────┴────┘    └────┴────┴────┴────┴────┘

★ = 본인 슬롯 (어느 슬롯이든 토글)
```

각 슬롯의 인터랙션:
- 빈 슬롯 클릭 → 챔프 + 라인 입력 모달
- 채워진 슬롯 클릭 → 수정 또는 비우기
- 슬롯 우상단 토글로 "확정 ↔ 의도" 변경
- 슬롯 좌상단 별 아이콘으로 "내 자리" 토글 (정확히 1개)

### 10.2 밴 입력

```
우리팀 밴  ○ ○ ○ ○ ○      적팀 밴  ○ ○ ○ ○ ○
```

각 ○ 클릭 → 챔프 검색 모달.

### 10.3 컴포 분석 카드 (별도, 추천 결과 위)

```
┌─────────────────────────────────────┐
│ 우리팀 컴포 분석     archetype: 엔게이지 (78%)  │
├─────────────────────────────────────┤
│ AD/AP 비율  ████████░░░░░░░░░  60% AD / 40% AP   │
│ Hard CC    ████████░░░░░░░░░  4건 (권장 2+)     │
│ 탱커       ██░░░░░░░░░░░░░░░  1명 (권장 1~2)    │
│ 이니시     ██████████░░░░░░░  강함 (말파 R)     │
│ 후반 스케일 ████░░░░░░░░░░░░░  중간                 │
│                                                  │
│ ⚠ AP 딜 22% (권장 30%+) — 추천 카드에 가중   │
└─────────────────────────────────────┘
```

부족한 항목은 빨강 강조 + GapDescriptor 메시지로 표시.

### 10.4 추천 결과 영역

```
[15개 카드 그리드, 5×3 또는 4×4 반응형]

밴된 카드는 동일 위치에 opacity 0.4 + BANNED 라벨

각 카드: §7 레이아웃
```

### 10.5 밴 추천 사이드 카드

페이지 우측 (또는 모바일 하단) 별도 카드:

```
┌──────────────────┐
│ 추천 밴 (메타 OP) │
├──────────────────┤
│ 1. 야스오   85점  │
│ 2. 흐웨이   82점  │
│ 3. 카직스   78점  │
│ ...              │
└──────────────────┘
```

### 10.6 시나리오 자동 표시

페이지 상단에 현재 인식된 시나리오 표시:

```
[감지된 시나리오] 후픽 + 같은 라인 적 명확
가중치: 카운터 50 / 메타 15 / 시너지 15 / 밸런스 15 / 의도 5
```

사용자가 가중치 시나리오를 수동 변경할 수도 있음 (디버깅/실험용).

---

## 11. Phase 작업 분해 (전체 일정)

| Phase | 산출물 | 예상 기간 |
|---|---|---|
| **4.0** | 디자인 + 더미 prototype (지금) | 1~2일 |
| **4.1** | 챔프 메타 태그 큐레이션 (170챔프) | 2~3일 |
| **4.2** | 매치업/시너지 매트릭스 워커 | 1주 |
| **4.3** | 백엔드 API (`POST /api/pick-recommend`) | 3~4일 |
| **4.4** | 프론트엔드 통합 (더미 → 실 API) | 2~3일 |
| **4.5** | 가중치 calibration (백테스트) | 1주 |
| **4.6** | 베타 + UX 개선 | 지속 |
| **4.7** | LCU 데스크톱 앱 (별도 명세) | 별도 |

### 11.1 Phase 4.0 (지금 작업) 상세

**산출물 3개**:

1. `pick-recommend.html` — UI 개편
2. `pick-engine.js` — 알고리즘 prototype (브라우저 동작, 더미 데이터)
3. `pick-data.js` — 더미 챔프 메타 (~20챔프) + 더미 매치업 + 더미 시너지

**검증 기준**:
- 입력 슬롯에 챔프 채우면 추천 카드 갱신
- 시나리오 (1픽 / 중간 / 후픽) 자동 분류 작동
- 컴포 분석 카드 갱신
- 추천 이유 텍스트 + 태그 생성
- 밴된 챔프 회색 표시
- 모바일 반응형 동작

### 11.2 Phase 4.1 — 챔프 메타 큐레이션

산출물: `packages/champion-meta/` 디렉토리에 3개 JSON

작업 분해:
1. ddragon 자동 추출 스크립트 (~70%) — 1일
2. 수동 큐레이션 (170챔프 × 4~5필드) — 1일
3. PR 리뷰 + 커뮤니티 검토 — 0.5일

### 11.3 Phase 4.2 — 워커

산출물:
- `apps/worker/src/jobs/match-aggregator.ts` — 매치업/시너지 집계
- DB 마이그레이션: `champion_matchups`, `champion_synergies` 테이블

기존 매치 수집 워커(이미 SPEC 명시)에 집계 단계 추가.

### 11.4 Phase 4.3 — 백엔드 API

```
POST /api/pick-recommend
Content-Type: application/json
Body: DraftState
Response: RecommendResult
```

엔진은 `pick-engine.js`를 TypeScript로 포팅 (`apps/api/src/pick-recommend/engine.ts`).

성능 목표: p95 < 200ms (캐시 히트 시 < 50ms).

캐싱 키: `${patch}:${bracket}:${myTeamHash}:${enemyTeamHash}:${bansHash}:${myLane}` → Redis 5분 TTL.

### 11.5 Phase 4.4 — 프론트 통합

`pick-recommend.html`의 더미 호출을 실 API 호출로 교체.

debounce 300ms (입력 변경 후 300ms 정지하면 호출).

오류 처리:
- 5xx → 직전 결과 유지 + "갱신 실패" 토스트
- 4xx (입력 오류) → 슬롯 강조

### 11.6 Phase 4.5 — Calibration

목표: 가중치 (M, C, S, B, R, I)를 데이터로 최적화.

방법:
1. 다이아+ 매치 1만 판 샘플링
2. 각 매치의 픽 순서대로 DraftState 재구성
3. 우리 알고리즘이 실제 픽한 챔프를 추천했는지 (top-5 hit rate, top-15 hit rate)
4. 우리가 추천한 챔프가 실제 그 매치에서 잘했는가 (KDA, AI Score, 승패)
5. Grid search로 가중치 최적화 (또는 Bayesian optimization)
6. 메타 1티어 챔프 제외하고 재학습 — "그냥 메타 추천"이 안 되도록

### 11.7 Phase 4.7 — LCU 데스크톱 앱 (미래)

별도 명세 문서 (`docs/desktop-lcu-spec.md`) 작성 예정.

핵심 인터페이스: LCU 폴링 → DraftState 객체 생성 → 우리 API 호출 → 결과 표시.

LCU API 엔드포인트:
- `/lol-champ-select/v1/session` — 픽창 상태
- `/lol-summoner/v1/current-summoner` — 본인 정보
- `/lol-platform-config/v1/namespaces/LcuSocial` — 친구 정보 (옵션)

본 명세의 DraftState 인터페이스가 변경 없이 그대로 호환되어야 함.

---

## 12. 가중치 Calibration 절차 (Phase 4.5 상세)

### 12.1 데이터 준비

1. 다이아+ 솔로랭크 매치 1만 판 (최근 1패치)
2. 각 매치의 timeline에서 픽창 데이터 추출 (게임 시작 직전 ~120초)
3. 픽 순서·라인·챔프 + 결과(승/패) + 각 참가자 KDA/CS/딜

### 12.2 평가 지표

```
top_5_hit_rate(weights) = 실제 픽된 챔프가 우리 알고리즘 top-5에 들어간 비율
top_15_hit_rate(weights) = top-15에 들어간 비율
recommended_winrate(weights) = 우리 top-5 추천 챔프가 실제 매치에서의 평균 승률
recommended_ai_score(weights) = 우리 top-5 추천 챔프의 평균 AI Score
```

### 12.3 최적화

목표: `0.5·top_15_hit_rate + 0.5·(recommended_winrate − 50)` 최대화.

방법: Grid search (각 가중치 5단계, 30^6 = 729M 조합 → bracket별 1만 판으로 샘플링하면 1시간 내 가능). 또는 Optuna 같은 Bayesian optimization.

### 12.4 Sanity check

- 메타 1티어 챔프(픽률 상위 10%) 제외하고 재학습 → 가중치가 너무 다르지 않아야 함
- 라인별 따로 최적화해서 가중치가 비슷한지 확인 (다르면 라인별 별도 가중치 도입)

### 12.5 운영 모니터링

API 응답에 가중치 버전 태그 → 사용자 클릭률·실제 픽률 로깅 → 주기적 재학습.

---

## 13. LCU 자동 입력 호환성 (Phase 4.7 미래)

데스크톱 앱에서 LCU API 폴링 시:

```typescript
async function buildDraftStateFromLcu(): Promise<DraftState> {
  const session = await lcuClient.get('/lol-champ-select/v1/session');
  const myTeam = mapLcuTeam(session.myTeam);     // SlotState[5]
  const enemyTeam = mapLcuTeam(session.theirTeam);
  const myBans = session.bans.myTeamBans.map(c => idToKey(c.championId));
  const enemyBans = session.bans.theirTeamBans.map(c => idToKey(c.championId));
  const phase = computePickPhaseGlobal(session);

  return {
    myTeam, enemyTeam, myBans, enemyBans,
    patch: currentPatch,
    tierBracket: pickBracketFromMyTier(),
    pickPhaseGlobal: phase,
  };
}

setInterval(async () => {
  const state = await buildDraftStateFromLcu();
  if (hasChanged(state, prevState)) {
    const result = await api.pickRecommend(state);
    renderResult(result);
  }
  prevState = state;
}, 1000);
```

본 명세의 DraftState 인터페이스가 그대로 입력으로 들어감 → 별도 어댑터 없음.

LCU `lol-champ-select/v1/session` 응답 구조의 변화 가능성 고려 — 매핑 함수 (`mapLcuTeam`, `idToKey`)는 별도 모듈로 분리해 변경 시 이 모듈만 수정.

---

## 14. Open Questions

1. **챔프 메타 태그 큐레이션 양식 검토자**: 본인 1명 vs 커뮤니티 PR 받을지
2. **신규 챔프 출시 직후**: 챔프 메타 태그 + 매치업 데이터 부족 → 어떻게 처리? (출시 후 1주 "데이터 부족" 표기 + 디폴트 태그?)
3. **칼바람(ARAM) 큐**: 본 시스템 적용 대상? (별도 명세 필요)
4. **자랭(Flex) 큐**: 솔랭과 같은 데이터 사용? (티어 구분이 다름)
5. **숨김 모드 (Hidden picks)**: 적팀이 픽창에서 챔프를 숨기는 기능(픽창 마지막 1초 이전) — 로컬에서는 보이지만 LCU 데이터로는 직전까지 안 보임. 어떻게 처리?
6. **Ranked 외 큐 (일반)**: 본 시스템 비활성화? 아니면 일반 데이터로 별도 집계?
7. **언어 다양화**: 자연어 추천 이유 i18n — 영어/일본어 템플릿도 같이 만들지?

---

## 16. 봇 라인 2v2 처리

봇 라인은 (원딜+서폿) vs (원딜+서폿)의 2:2 라인전. 1v1 가정으로는 정확도 떨어짐. 리서치 결과 lol.ps/u.gg/lolstats 모두 **풀 4중 매트릭스를 쓰지 않고 분해**함.

### 16.1 데이터 (`pick-data.js` 기준)

```js
BOT_DUO_SYNERGY[adcKey][supKey] = {
  wr,         // 페어 승률
  n,          // 표본 수
  delta,      // baseline 대비 시너지 (lolstats.gg "synergy %" 방식)
  archetype,  // 'engage'|'poke'|'pick'|'protect'|'sustain'|'onhit'|'killlane'
}
```

명시적으로 ADC↔Sup 조합만 저장 (라인 무관 시너지인 일반 SYNERGIES와 별도).

### 16.2 점수 컴포넌트 D_duo

봇 라인일 때만 활성화 (`myLane === 'adc' || myLane === 'support'`). 분해식:

```
D_duo(c) = 6 × duoSynergy(c, ourBotPartner).delta × partnerWeight
         + matchupDelta(c, sameRoleEnemy)
         + 0.3 × matchupDelta(c, oppositeRoleEnemy)        // cross-lane (약함)
         − 4 × enemyDuoSynergy.delta × min(adcWeight, supWeight)
```

`partnerWeight`: confirmed=1.0, intent=0.5, empty=0.

### 16.3 봇 전용 가중치 테이블 (WEIGHTS_BOT)

| 시나리오 | M | C | S | B | R | I | **D** |
|---|---|---|---|---|---|---|---|
| 1픽 정보없음 | 45 | 0 | 5 | 20 | 15 | 5 | **10** |
| 1픽 + 의도 | 35 | 0 | 10 | 20 | 5 | 10 | **20** |
| 중간 | 25 | 15 | 15 | 10 | 5 | 5 | **25** |
| 후픽 일반 | 15 | 25 | 15 | 10 | 0 | 5 | **30** |
| 후픽 + 같은라인 적 명확 | 10 | 30 | 10 | 10 | 0 | 5 | **35** |

봇이 아닌 라인은 일반 WEIGHTS 사용 (D=0~8).

### 16.4 UI — 봇 듀오 매치업 카드

본인이 봇일 때만 표시. 컴포 분석 카드 바로 아래.

```
┌─────────────────────────────────────────┐
│ 봇 라인 매치업  [2v2]      본인 원딜      │
├─────────────────────────────────────────┤
│ [케이틀린][룰루(파트너)]  VS  [진][쓰레쉬]│
│                                          │
│ 우리 듀오 시너지  +2.1%p (양호)          │
│ 적   듀오 시너지  +1.8%p                 │
│                                          │
│ 듀오 스타일: 프로텍트 vs 픽              │
└─────────────────────────────────────────┘
```

적 봇 한쪽 미픽 → 그 자리에 예측 챔프 (opacity 0.6) + "예상 32%" 라벨.

### 16.5 추천 카드의 Reason 강화

봇 후보 카드의 자연어 reason text에 봇 듀오 컨텍스트 자동 포함:

- `D > 8` + 파트너 시너지 +1%p 이상: `"케이틀린과 봇 듀오 시너지 +2.1%p"`
- `D > 6` + 적 봇 예측됨: `"예상 적 원딜 진 카운터 가능"`

### 16.6 데이터 부족 시

- 봇 듀오 페어 n<50: 점수 ×0.5 + 카드에 "표본 부족" 툴팁
- 직전 패치 데이터 fallback (§5.4와 동일 규칙)

---

## 17. 미픽 슬롯 픽 예측

양 팀 모든 미픽 슬롯에 대해 **조건부 확률 분포**로 어떤 챔프가 픽될지 예측. lol.ps/op.gg/u.gg 등 stats 사이트는 안 함 → **차별화 포인트**.

### 17.1 데이터 (`pick-data.js`)

```js
// Anchor 챔프가 우리팀에 픽됐을 때, 다른 라인 partner 빈도
COPICK_PROBS[anchorChamp][partnerLane][partnerChamp] = prob (0..1)

// Lane meta priors (각 라인의 챔프별 픽률 → softmax 정규화)
LANE_META_PRIORS[lane][champ] = prob (자동 계산)
```

COPICK_PROBS는 sparse — anchor에 해당하는 챔프(컴포에 강한 영향 주는 챔프)만 저장. 미정의 anchor는 LANE_META_PRIORS로 폴백.

### 17.2 함수 `predictAllMissingPicks(state)`

양 팀 5+5=10 슬롯 중 미픽 슬롯에 대해 top-K 후보 + 확률 반환:

```js
{
  my: { 0: null, 1: null, ..., 4: [{c, lane, prob}, ...] },
  enemy: { 0: null, ..., 4: [...] }
}
```

### 17.3 점수 모델 (단순 통계, 딥러닝 X)

각 후보 챔프 c에 대해:

```
score(c | team, lane) =
    0.5 · metaScore(c, lane)              // 티어 강도
  + 0.2 · synergyWithOwnPicks(c)          // 자기 팀 픽들과 시너지
  + 0.2 · copickPrior(c | anchors, lane)  // anchor 시 빈도
  + 0.2 · laneMetaPrior(c, lane)          // 라인별 픽률
  + 0.1 · counterAvoidance(c | opposing)  // 우리 카운터 회피
```

→ Softmax (temperature=2.0) → 확률 분포 → top-K (현재 K=5).

**왜 딥러닝 안 하는가**: 챔프 ~170개. Co-pick 매트릭스 = 170² ≈ 29k 셀. Lane meta = 5 × 170 = 850 셀. 통계 충분. 딥러닝(LoLDraftAI류 트랜스포머)의 효용은 데이터가 sparse + 차원이 high일 때 — 우리 케이스는 아님.

### 17.4 Lane 자동 추론

미픽 슬롯에 lane이 없으면 **그 팀에 비어있는 라인 중 하나**로 추론:
- 비어있는 라인이 1개면 그 라인 사용
- 여러 개면 lane=null로 두고 챔프의 `meta.lanes` 필터로 후보 한정

### 17.5 Counter score에 반영 (Expected Counter)

기존 `C_counter`를 확장:

```
counter(c) = max over enemy slot of:
  if confirmed: matchupDelta(c, enemy) × confidence × laneWeight × 1.0
  if predicted: Σ p.prob · matchupDelta(c, p.c) × confidence × laneWeight × 0.5
                                                                          ↑
                                                      PREDICTED_COUNTER_DISCOUNT
```

확정픽은 1.0 가중, 예측은 0.5 가중 — "예측은 추정이지 확정이 아니다" 안전장치.

### 17.6 UI — 미픽 슬롯 고스트 표시

모든 미픽 슬롯에 예측 top 3 chip 행:

```
┌──────────┐
│ R5       │
│ + 픽 추가 │
│ 서폿      │
│ ──────── │
│ 예상      │
│ [룰] 룰루 32%│
│ [노] 노틸 18%│
│ [쓰] 쓰레쉬 14%│
│       의도/확정 │
└──────────┘
```

표본 부족(softmax sum<임계) 시 chip 흐림 + "표본 부족" 툴팁.

### 17.7 적 픽 예측 정확도

- 1패치 솔로랭크 데이터로는 top-5 hit rate 약 60~70% 예상 (calibration 후)
- 다이아+ 같은 좁은 구간은 더 높음 (메타가 좁음)
- LoLDraftAI 트랜스포머는 유사 정확도, 더 무거움
- 우리 모델이 더 빠르고 설명 가능 (각 후보의 점수 분해 가능)

---

## 15. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v0.1 | 2026-05-11 | 초안 작성 (사용자와 합의된 v3 알고리즘 + UI 변경 + Phase 분해) |
| v0.2 | 2026-05-11 | §16 봇 라인 2v2 처리 + §17 미픽 슬롯 픽 예측 추가 (D_duo 컴포넌트 + 조건부 확률 모델) |

---

**관련 문서**

- `PRD.md` §6 Phase 4
- `SPEC.md` §5.7 F-7xx 픽 추천 기능
- `CLAUDE.md` §11 작업 흐름
- `prototype/pick-recommend.html` (Phase 4.0 산출물)
- `prototype/pick-engine.js` (Phase 4.0 산출물)
- `docs/desktop-lcu-spec.md` (Phase 4.7 별도, 미작성)
