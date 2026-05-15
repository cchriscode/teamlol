# 챔프 티어 (PS Score) — 상세 명세

| 항목 | 내용 |
|---|---|
| 문서 버전 | v0.1 |
| 작성일 | 2026-05-11 |
| 상태 | 설계 합의 완료 — 구현 (Phase 4.0 prototype 동작) |
| 관련 문서 | `SPEC.md` §5.3 F-3xx, §5.4 F-401, `docs/pick-recommend-spec.md` §5 |
| 구현 모듈 | `tier-engine.js` (단일 책임 모듈) |

---

## 1. 개요

라인×챔프×bracket 단위의 **PS Score**(0~100)를 산출. 챔피언 티어표와 픽 추천의 메타 점수가 모두 이 한 함수를 호출 — **Single Source of Truth**.

### 1.1 사용처
- `champions.html` (티어표 메인)
- `champion-detail.html` (챔프 헤더 PS / 라인별 표시)
- `pick-engine.js` (`metaScore` → `TierEngine.rowFor` 위임)
- `summoner-champions.html` (참고용 옵션)

### 1.2 차별화
- **공식 공개** (op.gg/u.gg/lol.ps 모두 미공개)
- **lolalytics PBI** 차용 + Wilson lower bound (가장 transparent한 통계 방법)
- **꿀챔 점수** 별도 컬럼 (lol.ps 시그니처)
- (Phase 3) Counter-coverage 보정 + 2D OTP 컬럼 (어떤 사이트도 안 함)

---

## 2. 입력 / 출력

```typescript
type ChampStats = {
  wr: number;        // % (0~100)
  pickrate: number;  // %
  banrate: number;   // %
  n: number;         // games sample size
  wins?: number;     // optional; computed from wr×n if absent
};

type Tier = 'S+' | 'S' | 'A' | 'B' | 'C' | 'D';
type Confidence = 'high' | 'medium' | 'low' | 'too_low';

type TierRow = {
  champion: ChampionKey;
  lane: Lane;
  rank: number;
  stats: ChampStats;
  psScore: number;          // 0~100
  letter: Tier;
  letterClass: string;      // CSS class for color
  breakdown: { wrWilson, wrComponent, pbi, pick, ban, penalty, raw };
  confidence: Confidence;
  honey: number;            // 꿀챔 점수
  trend: { label, wrDelta, prRatio };
  trendArrow: '▲▲'|'▲'|'━'|'▼'|'▼▼';
  trendClass: 'change-up'|'change-down'|'change-same';
};
```

---

## 3. 알고리즘 — PS Score

### 3.1 공식

```
PS_raw = 0.55 × WR_component
       + 0.20 × PBI_component
       + 0.15 × pick_component
       + 0.10 × ban_component
       − sample_penalty

PS_Score = 50 + 50 × tanh(PS_raw / 25)   // sigmoid → 0~100, center 50
```

### 3.2 컴포넌트 정의

#### WR_component — Wilson Lower Bound 기반 승률

```
WR_wilson(p, n, z=1.96) = (p + z²/2n − z·√[(p(1−p) + z²/4n)/n]) / (1 + z²/n)
WR_component = (WR_wilson × 100 − 50) × 5
```

- z=1.96 → 95% 신뢰구간 하한
- 표본 100판 60% WR → Wilson ≈ 50.2% (보수적)
- 표본 1만판 53% WR → Wilson ≈ 52.0% (확신)

→ 비주류 챔프(낮은 표본)의 노이즈 자동 제거.

#### PBI_component — lolalytics PBI

```
PBI = (WR − tier_avg_WR) × 100 × pickrate / (100 − min(banrate, 50))
PBI_component = clip(PBI, -50, +50)
```

- 픽률은 **신뢰도 + 강도** 둘 다 가중 (곱셈)
- 밴률은 **분모로 인플레이트** — 자주 밴되는 챔프가 데이터에서 사라져도 점수 보존
- BR 50%에서 분모 saturate (perma-ban dominance 방지)

#### pick_component — log-scaled 인기도

```
pick_component = log10(1 + pickrate) × 12
```

- 픽률 0.5% → 0.5점
- 픽률 5% → 9.4점
- 픽률 15% → 12.6점
- log10으로 인기 챔프 dominate 방지

#### ban_component — 위협 시그널 (capped)

```
ban_component = min(banrate / 30, 1.0) × 6
```

- BR 30% 이상은 saturate (퍼마밴 챔프가 일방적으로 점수 먹지 않게)
- 자주 밴 = 무서운 챔프 = 강함 (positive signal)

#### sample_penalty — 표본 부족 페널티

```
sample_penalty(n) = 5 × max(0, 1 − √n / √(n + 2000))
```

- N < 200: penalty ≈ 4
- N = 1000: penalty ≈ 1.7
- N = 5000: penalty ≈ 0.5
- N = 50000: penalty ≈ 0.05

→ 부드러운 곡선 감쇠, 단순 cutoff X.

### 3.3 가중치 정당화

| 가중치 | 값 | 근거 |
|---|---|---|
| WR | 0.55 | u.gg/op.gg/lolalytics 모두 WR을 primary 신호로 사용 (~50~70%) |
| PBI | 0.20 | lolalytics 차용. 픽률·밴률을 한 번에 처리 |
| Pick | 0.15 | 인기도 confidence (log-scaled로 dominate 방지) |
| Ban | 0.10 | 위협 신호. BR 단독으로 큰 영향 X |

총합 1.00. tanh sigmoid로 0~100 정규화.

---

## 4. 티어 라벨 (S+/S/A/B/C/D)

| PS Score | 라벨 | CSS |
|---|---|---|
| 65+ | **S+** (OP) | tier-challenger |
| 58~65 | **S** | tier-master |
| 53~58 | **A** | tier-diamond |
| 48~53 | **B** | tier-emerald |
| 42~48 | **C** | tier-gold |
| <42 | **D** | tier-silver |

UI에 점수 + 라벨 chip 동시 표시.

---

## 5. 표본 크기 임계

| N (games) | 처리 |
|---|---|
| ≥ 5000 | confidence='high' — 정상 |
| 1000~5000 | confidence='medium' — sample_penalty 적용 |
| 200~1000 | confidence='low' — 점수 표시하되 "low confidence" 배지 |
| < 200 | confidence='too_low' — 티어 미표시 ("표본 부족") |

Phase 4.1 정식 데이터에서는 N≥1000 cutoff (champions.html 기본 필터).

---

## 6. 꿀챔 점수 (SPEC F-307)

높은 WR + 낮은 픽률 + 낮은 밴률 = 숨겨진 OP.

```
honey(c) = max(0, WR − 50) × 1.5
         + max(0, 5 − pickrate) × 1.0
         + max(0, 5 − banrate) × 0.5
   (N < 200이면 0)
```

- WR 60% + PR 1% + BR 0% = 22.5점
- WR 52% + PR 5% + BR 5% = 3점
- WR 53% + PR 12% + BR 10% = 4.5점

PS Score와 별도 컬럼.

---

## 7. 추세 (Trend)

PS에 섞지 않고 별도 시그널.

```
WR_delta = WR_now − WR_prev_patch
label =
  WR_delta ≥ +1.5 (and N ≥ 500)  → 'rising_strong' (▲▲)
  WR_delta ≥ +0.5                → 'rising'        (▲)
  WR_delta ≤ -1.5                → 'falling_strong' (▼▼)
  WR_delta ≤ -0.5                → 'falling'       (▼)
  else                           → 'stable'        (━)
```

champions.html "변동" 컬럼이 표시.

데이터 의존성: **이전 패치 스냅샷 보존** 필요 (현재 prototype은 `TIER_DATA_PREV` 더미). Phase 4.2 워커가 매일 자정 스냅샷 저장 → 30일 보관.

---

## 8. 라인 분리 + 다라인 챔프

- 라인×챔프 단위로 별도 PS 계산 (Yasuo mid vs Yasuo top 다른 점수)
- 픽률 0.5% 미만은 그 라인 미표시 (champions.html 기본)
- 멀티라인 챔프는 각 라인별 행으로 분리

---

## 9. Tier Bracket 처리

| Bracket | 데이터 출처 |
|---|---|
| `emerald+` | 다이아몬드 이하 + 이상 모두 포함 (광범위) |
| `diamond+` | 다이아 이상 |
| `master+` | 마스터 이상 |
| `gm+` | 그랜드마스터 이상 |
| `challenger+` | 챌린저만 |

champions.html은 bracket 셀렉터 노출 (디폴트: diamond+, 본인 티어 ≥ master면 자동 상향).

---

## 10. pick-engine 통합 (단일 책임)

`pick-engine.js`의 `metaScore(c, lane)`:

```js
function metaScore(c, lane) {
  if (!lane) return 0;
  if (window.TierEngine) {
    const row = window.TierEngine.rowFor(c, lane);
    if (!row) return 0;
    return (row.psScore - 50) * 1.0;  // ±50 contribution
  }
  // fallback: 기존 단순 공식
}
```

→ TierEngine 한 곳만 고치면 챔피언 티어표 + 픽 추천이 동시에 갱신됨.

---

## 11. 데이터 의존성

| 데이터 | 출처 | 갱신 주기 |
|---|---|---|
| 라인×챔프×bracket WR/PR/BR/N | 자체 워커 (SPEC F-301) | 1시간 |
| 7일 전 스냅샷 (trend용) | 자체 워커 (매일 자정 cron) | 일 1회 |
| tier_avg_WR (라인별) | 자체 집계 (라인 평균) | 1시간 |

---

## 12. 차별화 (Phase 3 미룸)

### 12.1 Counter-coverage adjustment

"내 카운터들이 메타에서 사라지면 내 WR이 부풀려짐" 보정.

```
counter_inflation(c) = Σ_{c가 카운터인 chmp c'} pick%(c') × counter_gap(c, c')
adjusted_WR = WR_wilson(c) − 0.3 × counter_inflation(c)
```

매치업 매트릭스 데이터 필요 (Phase 4.2 이후).

### 12.2 2D 강도×난이도 (OTP 컬럼)

mobalytics의 큐레이션 방식을 정량화:
- **Avg Player Tier**: 일반 유저 PS
- **OTP Tier**: 그 챔프 100판+ 유저들의 best-on-champion WR

→ "야스오: 일반 49.5% / OTP 56.2%" 같은 숙련도 곡선 가시화.

PUUID별 챔프 게임수 집계 워커 필요.

---

## 13. 함수 시그니처 (`tier-engine.js`)

```js
TierEngine.computePS(stats, tierAvgWr) → { score, letter, breakdown, confidence }
TierEngine.honeyChampScore(stats) → number
TierEngine.detectTrend(currentStats, prevStats) → { label, wrDelta, prRatio }
TierEngine.rowFor(champKey, lane) → TierRow | null
TierEngine.tierTable(lane, { minPickrate, includeLowSample }) → TierRow[]
TierEngine.fullTable(options) → TierRow[]
TierEngine.wilsonLowerBound(wins, games, z=1.96) → number
TierEngine.letterTier(score) → Tier
TierEngine.letterTierClass(letter) → string
TierEngine.trendArrow(label) → string
TierEngine.trendClass(label) → string
```

---

## 14. Phase 분해

| Step | 산출물 | 상태 |
|---|---|---|
| 4.0a | `tier-engine.js` 신규 + champions.html 동적 렌더 | ✓ 완료 |
| 4.0b | `pick-engine.js` 단일 책임 통합 (metaScore 위임) | ✓ 완료 |
| 4.0c | `pick-data.js`에 `TIER_DATA_PREV` 더미 추가 | ✓ 완료 |
| 4.1  | 라인×챔프×bracket WR/PR/BR/N 워커 (실 데이터) | 대기 |
| 4.2  | 7일 스냅샷 cron + trend 정확도 검증 | 대기 |
| 4.3  | champion-detail.html 헤더 PS도 동적 호출로 통합 | 대기 |
| 5.x  | (Phase 3) Counter-coverage adjustment | 대기 |
| 5.x  | (Phase 3) 2D OTP 컬럼 + 워커 | 대기 |

---

## 15. 변경 이력

| 버전 | 날짜 | 변경 내용 |
|---|---|---|
| v0.1 | 2026-05-11 | 초안 작성 (Wilson + PBI + log Pick + Ban cap + Sample Penalty + Honey + Trend) |
