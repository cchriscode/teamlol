# AI Score 알고리즘 사양 (v2.0)

> **버전**: `ai-score@2.0`
> **갱신일**: 2026-05-11
> **이전 버전 폐기**: v1 (cohort baseline + z-score + phase decomposition)

매치 종료 후 한 명의 플레이어가 **얼마나 잘했는지**를 0~100 점으로 환산한 단일 지표.
같은 매치 10명에게 모두 적용되며, 그 결과로 **MVP**(이긴 팀 1위) / **ACE**(진 팀 1위)를 산정한다.

---

## 1. 설계 결정 (v2 핵심)

### 1.1 코호트 baseline 폐기 → 절대 LUT
v1에서는 (챔피언 × 라인 × 브래킷 × 승/패) 코호트의 평균/표준편차를 누적 후 z-score 정규화했다. 다음 이유로 폐기:

- **콜드 스타트**: 코호트 행이 없으면 점수 계산 불가
- **샘플 부족**: 신챔프, 신패치, 마이너 라인 픽 → noisy baseline → noisy 점수
- **계산 비용**: 매치 ingest 시 코호트 lookup 10회 (DB) → hot path 부하
- **설명력 부족**: "이 챔프는 평균 KDA가 X였고…" — 사용자 입장에서 "그래서 얼마나 잘한 건데?" 답이 안 나옴

대신 **절대 LUT**(Look-Up Table) 방식으로 교체:

- 컴포넌트별 raw 값 → LUT로 0~100 환산
- LUT는 KR 다이아+ 분포를 기반으로 한 번만 캘리브레이션 (코드 상수)
- DB 조회 0회, 계산은 in-memory 상수 시간

### 1.2 Phase 분해 폐기
v1의 라인전(0~14m) / 미드(14~25m) / 후반(25m+) 단계 분해도 폐기. KR Challenger 매치 ~1000개에서 챔프×라인×단계 셀당 평균 12 샘플 → 통계적 의미 없음.

### 1.3 Anti-padding 컬럼 폐기 (`worthlessDeaths`, `freeKillsCount`)
- `worthlessDeaths`: 25분 게이트만 적용된 가짜 휴리스틱. 실제 리스폰 타이머 기반 구현 어려움. **`timeDeadPct` 한 컬럼으로 충분**.
- `freeKillsCount`: 계산만 하고 사용처 없었음. 도메인 정의 모호 (적팀 분산 + 오브젝트 진행 + 거리 판정 등 false positive 큼).

→ 두 컬럼 모두 schema·parser·engine에서 삭제.

### 1.4 MVP / ACE는 매치 단위 결정
v1은 참가자 단위로 `is_mvp` / `is_ace` 플래그를 저장하려 했으나, 매치 컨텍스트가 필요하므로 **컬럼 저장 없이 query/render time에 결정**:
- 한 매치의 10명 점수가 모이면 팀별 max 1명만 표시
- 백엔드는 `ai_score_cached` (점수)와 `ai_score_letter` (등급)만 저장
- MVP/ACE 라벨은 frontend에서 `withMvpAce()` 한 줄로 부여

---

## 2. 컴포넌트 (7개)

| key | 의미 | 단위 | LUT 적용 영역 |
|---|---|---|---|
| `kda` | (K + A) / max(1, D) | 비율 | 0 ~ 6+ |
| `kp` | 킬관여율 | % | 0 ~ 70+ |
| `cs` | CS / 분 | int/min | 0 ~ 9+ (라인 다름) |
| `dmgShare` | 챔프딜 / 팀챔프딜 | % | 0 ~ 32+ |
| `takenShare` | 받은 피해 / 팀 받은 피해 | % | 0 ~ 30+ (탱커) |
| `vision` | 시야점수 / 분 | float/min | 0 ~ 1.5+ (라인 다름) |
| `dmgObj` | 오브젝트 딜 / 분 | int/min | 0 ~ 800+ (정글) |

각 컴포넌트는 LUT를 통과해 **0~100 점** 으로 환산된다 (선형 보간, 양 끝 클램프).

---

## 3. LUT 표

### 3.1 KDA
```
KDA ≥ 6.0 → 100
KDA   4.0 →  82
KDA   3.0 →  68
KDA   2.2 →  55
KDA   1.5 →  42
KDA   1.0 →  28
KDA   0.5 →  12
KDA   0.0 →   0
```

### 3.2 KP%
```
KP ≥ 70%  → 100
KP   60%  →  85
KP   50%  →  70
KP   40%  →  55
KP   30%  →  40
KP   20%  →  25
KP   10%  →  10
KP    0%  →   0
```

### 3.3 CS / 분 (라인별)

**탑 / 미드 / 원딜**:
```
9+ → 100, 8 → 85, 7 → 70, 6 → 55, 5 → 40, 4 → 25, 3 → 10, 0 → 0
```

**정글** (CS = lane minions + neutral monsters):
```
6.5+ → 100, 5.5 → 80, 4.5 → 60, 3.5 → 40, 2.5 → 20, 0 → 0
```

**서포터**:
```
4+ → 100, 3 → 80, 2 → 60, 1 → 40, 0.5 → 20, 0 → 0
```

### 3.4 챔프딜 비중 (% of team)
```
32+ → 100, 28 → 85, 24 → 70, 20 → 55, 16 → 40, 12 → 25, 8 → 10, 0 → 0
```

### 3.5 받은 피해 비중 (% of team) — 탱커 평가
```
30+ → 100, 25 → 80, 20 → 60, 15 → 40, 10 → 20, 0 → 0
```

### 3.6 시야 / 분 (라인별)

**탑 / 미드 / 원딜**:
```
1.5+ → 100, 1.2 → 80, 1.0 → 65, 0.8 → 50, 0.6 → 35, 0.4 → 20, 0 → 0
```

**정글**:
```
2.0+ → 100, 1.6 → 80, 1.3 → 65, 1.0 → 50, 0.7 → 35, 0 → 0
```

**서포터**:
```
3.0+ → 100, 2.5 → 85, 2.0 → 70, 1.5 → 55, 1.0 → 40, 0.7 → 25, 0 → 0
```

### 3.7 오브젝트 딜 / 분 — 정글 평가
```
800+ → 100, 600 → 80, 400 → 60, 250 → 40, 150 → 25, 50 → 10, 0 → 0
```

---

## 4. 라인별 가중치 (총합 100)

| 라인 | KDA | KP | CS | 챔프딜 | 받피해 | 시야 | 오브젝트 |
|---|---:|---:|---:|---:|---:|---:|---:|
| top     | 25 | 10 | 20 | 25 | 10 | 10 | 0  |
| jungle  | 25 | 15 | 10 | 15 | 0  | 15 | 20 |
| mid     | 25 | 10 | 25 | 30 | 0  | 10 | 0  |
| adc     | 25 | 10 | 25 | 30 | 0  | 10 | 0  |
| support | 25 | 20 |  5 | 15 | 0  | 35 | 0  |

설계 의도:
- **탑**: 받피해(탱킹) + 챔프딜 동시 평가
- **정글**: 오브젝트 + KP가 핵심, 시야 비중도 큼
- **미드/원딜**: CS·챔프딜 우위 → 캐리력 평가
- **서포터**: 시야가 절반 가까이 (35), CS 거의 무시 (5)

---

## 5. 점수 계산

```
점수 = Σ ( componentScore[k] × weight[k] / 100 )    for k in 7 components
등급 = letterFor(점수)
```

LUT 통과 후 점수가 0~100, 가중치 합도 100이므로 **결과는 0~100 보장**.

### 등급
```
점수 ≥ 88 → S+
점수 ≥ 78 → S
점수 ≥ 66 → A
점수 ≥ 50 → B
점수 ≥ 35 → C
그 외     → D
```

---

## 6. MVP / ACE

매치당 한 번 결정. 10명 점수가 모인 후:

```ts
function withMvpAce(scoredPlayers) {
  const blue = scoredPlayers.filter(p => p.team === 'blue');
  const red  = scoredPlayers.filter(p => p.team === 'red');
  const blueWin = blue.length && blue[0].win;
  const winners = blueWin ? blue : red;
  const losers  = blueWin ? red  : blue;
  if (winners.length) winners.reduce((a, b) => a.score >= b.score ? a : b).label = 'MVP';
  if (losers.length)  losers.reduce((a, b) => a.score >= b.score ? a : b).label = 'ACE';
}
```

- 팀별 동점 → 더 낮은 슬롯(즉, 먼저 픽한 사람) 우선 (`>=` 비교의 자연스러운 결과)
- 점수 50 이하라도 그 팀 1위면 MVP/ACE 부여 (상대 평가)

---

## 7. 데이터 흐름

```
Riot MATCH-V5
     ↓
parseMatch()         → ParsedParticipant (per player)
     ↓
teamTotalsFrom()     → { dmgToChampPerMin: {blue, red}, damageTakenPerMin: {blue, red} }
     ↓
computeAIScore()     → { score, letter, algoVersion }
     ↓
match_participants
   .ai_score_cached        : real (점수, 0~100)
   .ai_score_letter        : text ('S+'|'S'|'A'|'B'|'C'|'D')
   .ai_score_algo_version  : text ('ai-score@2.0')
```

MVP/ACE는 저장하지 않음. `match_participants`를 매치 단위로 SELECT 후 frontend에서 `withMvpAce()` 적용.

---

## 8. 구현

| 위치 | 책임 |
|---|---|
| `backend/apps/worker/src/ai-score/engine.ts` | computeAIScore, teamTotalsFrom, LUT 정의 — **single source of truth** |
| `backend/apps/worker/src/persist/match.ts` | ingest 시점에 호출 → `ai_score_cached` 영구 저장 |
| `frontend/ai-score-engine.js` | 백엔드 engine.ts와 1:1 미러링 (LUT·가중치 동일) — UI에서 단독 매치 점수 재계산 / 데모 |

**중요**: 두 엔진의 LUT 표·가중치·등급 임계치는 코드상 동기화되어야 한다. 한쪽 변경 시 양쪽 동시 수정.

---

## 9. 캘리브레이션 노트

LUT 임계치는 **KR Diamond+ 솔로큐 분포 추정값**으로 시작한다. 데이터 누적 후 실제 분포 보고 조정 가능:

- 등급 분포 목표: S+ ~5%, S ~15%, A ~25%, B ~30%, C ~20%, D ~5%
- 라인별 평균 점수: 50~55 부근 (균형 가중치)
- 50점이 "평균 플레이"의 의미가 되도록 조정

분포가 한쪽으로 치우치면 (예: 모두 B 이하) 가중치 또는 LUT 임계치를 완화한다.

현재 라이브 검증 결과 (130 match_participants 표본, 2026-05-11):
- 평균 67.85, 범위 27.6 ~ 94.7
- 등급 분포 합리적 (S+/S/A/B/C/D 모두 출현)
- → 첫 캘리브레이션 통과. 1000+ 매치 누적 후 재검토.

---

## 10. v1과의 차이 요약

| 항목 | v1 | v2 |
|---|---|---|
| baseline | 코호트 z-score | 절대 LUT |
| 컴포넌트 수 | 9 | 7 |
| Phase 분해 | 라인전/미드/후반 | 없음 |
| anti-padding | worthlessDeaths × 1.5, freeKills × 0.5 | 없음 (timeDeadPct로 충분) |
| MVP/ACE | per-row 컬럼 (계획만) | 매치 단위 query/render time 결정 |
| DB 의존 | 매치당 cohort lookup 10회 | 0 (순수 함수) |
| 콜드 스타트 | baseline 누적 전 무용 | 1매치부터 동작 |
| 샘플 수 의존성 | 高 | 無 |
| 설명력 | "코호트 평균 대비 z=1.2" | "80점 = 잘함" |

---

## 11. 알려진 한계

1. **챔프 특성 무시**: 소라카가 80점 받기 어렵고, 야스오가 D받기 쉬움. → 라인 가중치로 80% 흡수, 나머지는 LUT 캘리브레이션으로 (S/D 비율이 챔프별로 비대칭이면 OK한 신호로 본다).
2. **승패 보정 없음**: 진 팀이라고 페널티 없고 이긴 팀이라고 보너스 없음. 같은 점수 받은 두 명은 승패와 무관하게 동일 평가.
3. **게임 길이 짧을 때**: 게임 시간이 짧을수록 분당 지표(CS/분, 시야/분)가 노이즈 큼. 향후 게임 길이 가중 보정 검토 가능.

이 한계는 모두 **명시적 trade-off**다. 단순함과 콜드 스타트 동작이 우선이다.
