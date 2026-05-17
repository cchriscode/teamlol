'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { createPickEngine } from '@/lib/pick-engine';
import type { PickData, DraftState, SlotState, Lane } from '@/lib/pick-types';

const ALL_LANES: Lane[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const LANE_KR: Record<string, string> = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' };
function laneKr(l: string): string { return LANE_KR[l] ?? '?'; }

const PICK_ORDER = [
  { num: 1,  team: 'blue', label: 'B1' },
  { num: 2,  team: 'red',  label: 'R1' },
  { num: 3,  team: 'red',  label: 'R2' },
  { num: 4,  team: 'blue', label: 'B2' },
  { num: 5,  team: 'blue', label: 'B3' },
  { num: 6,  team: 'red',  label: 'R3' },
  { num: 7,  team: 'red',  label: 'R4' },
  { num: 8,  team: 'blue', label: 'B4' },
  { num: 9,  team: 'blue', label: 'B5' },
  { num: 10, team: 'red',  label: 'R5' },
] as const;

const SCENARIO_KR: Record<string, string> = {
  first_blind: '선픽 (정보 없음)',
  first_with_intent: '선픽 + 팀 의도 있음',
  middle: '중간 픽',
  last_general: '후픽 (일반)',
  last_counter_clear: '후픽 + 같은 라인 적 명확',
};

function initialState(): DraftState {
  const mkTeam = (markFirstAsMine: boolean): SlotState[] =>
    Array.from({ length: 5 }, (_, i) => ({
      pickOrder: i + 1,
      status: 'empty' as const,
      isMine: markFirstAsMine && i === 0,
    }));
  return {
    pickPhaseGlobal: 1,
    myTeam: mkTeam(true),
    enemyTeam: mkTeam(false),
    myBans: [],
    enemyBans: [],
    mySide: 'blue',
  };
}

interface Props {
  initialData: PickData;
}

type ModalTarget =
  | { kind: 'pick'; side: 'my' | 'enemy'; idx: number }
  | { kind: 'ban';  side: 'my' | 'enemy'; idx: number };

export function PickRecommendApp({ initialData }: Props) {
  const data = useMemo(() => {
    // pick-engine expects several helper functions on PickData. JSON
    // serialization on the server drops them; re-attach here so the engine
    // can call D.listChampions(), D.copickProb(), etc.
    const d = initialData as unknown as Record<string, unknown>;
    const COPICK = (d.COPICK_PROBS as Record<string, Record<string, Record<string, number>>>) ?? {};
    return {
      ...initialData,
      nameKr: (key: string) => initialData.CHAMPIONS[key]?.nameKr ?? key,
      listChampions: () => Object.keys(initialData.CHAMPIONS),
      seasonGames: (_key: string) => 0,
      isBlindSafe: (key: string) => !!initialData.CHAMPIONS[key]?.blindPickSafe,
      effectiveDifficulty: (key: string) => initialData.CHAMPIONS[key]?.difficulty ?? 5,
      laneMetaPrior: (_champ: string, _lane: string) => 0,
      copickProb: (anchor: string, partnerLane: string, partner: string) => {
        const a = COPICK[anchor];
        if (a && a[partnerLane] && a[partnerLane][partner] != null) return a[partnerLane][partner];
        return null;
      },
    } as unknown as PickData;
  }, [initialData]);

  const engine = useMemo(() => createPickEngine(data), [data]);
  const [state, setState] = useState<DraftState>(initialState);
  const [modalFor, setModalFor] = useState<ModalTarget | null>(null);

  const result = useMemo(() => {
    try { return engine.recommend(state) as any; } catch { return null; }
  }, [engine, state]);

  const setTeamSlot = useCallback((side: 'my' | 'enemy', idx: number, patch: Partial<SlotState>) => {
    setState((prev) => {
      const key = side === 'my' ? 'myTeam' : 'enemyTeam';
      const team = [...prev[key]];
      team[idx] = { ...team[idx], ...patch };
      return { ...prev, [key]: team };
    });
  }, []);

  const toggleMine = (idx: number) => {
    setState((prev) => ({ ...prev, myTeam: prev.myTeam.map((s, i) => ({ ...s, isMine: i === idx })) }));
  };
  const toggleStatus = (side: 'my' | 'enemy', idx: number) => {
    setState((prev) => {
      const key = side === 'my' ? 'myTeam' : 'enemyTeam';
      const team = [...prev[key]];
      const cur = team[idx].status;
      team[idx] = { ...team[idx], status: cur === 'confirmed' ? 'intent' : 'confirmed' };
      return { ...prev, [key]: team };
    });
  };
  const setSide = (side: 'blue' | 'red') => setState((prev) => ({ ...prev, mySide: side }));

  const setBan = (side: 'my' | 'enemy', idx: number, champion: string | undefined) => {
    setState((prev) => {
      const key = side === 'my' ? 'myBans' : 'enemyBans';
      const bans = [...prev[key]];
      if (champion === undefined) { bans.splice(idx, 1); }
      else { bans[idx] = champion; }
      return { ...prev, [key]: bans };
    });
  };
  const setPick = (side: 'my' | 'enemy', idx: number, champion: string | undefined) => {
    setTeamSlot(side, idx, { champion, status: champion ? 'confirmed' : 'empty' });
  };

  const physicalSideOf = (side: 'my' | 'enemy') =>
    side === 'my' ? state.mySide : (state.mySide === 'blue' ? 'red' : 'blue');
  const pickNumLabel = (side: 'my' | 'enemy', pickOrder: number) => {
    const t = physicalSideOf(side);
    return `${t === 'blue' ? 'B' : 'R'}${pickOrder}`;
  };

  const inferLane = (championKey: string): string | null => {
    const tier = data.TIER_DATA[championKey] ?? {};
    let bestLane: string | null = null, bestRate = 0;
    for (const [ln, stats] of Object.entries(tier)) {
      const pr = (stats as { pickrate?: number }).pickrate ?? 0;
      if (pr > bestRate) { bestRate = pr; bestLane = ln; }
    }
    return bestLane;
  };

  const myColor = state.mySide;
  const enColor = state.mySide === 'blue' ? 'red' : 'blue';

  return (
    <>
      <header style={{ marginBottom: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div>
          <h1 className="page-title">
            픽 추천 <span className="tier-badge tier-master" style={{ marginLeft: 6 }}>BETA</span>
          </h1>
          <p className="page-subtitle">챔프 셀렉트 단계의 픽·밴·순서·라인을 입력하면 종합 점수로 추천합니다</p>
        </div>
        <div className="side-toggle" role="group" aria-label="내 팀 사이드">
          <span className="side-toggle-label">내 자리</span>
          <button type="button" className={`side-toggle-btn${state.mySide === 'blue' ? ' active' : ''}`} onClick={() => setSide('blue')}>블루팀</button>
          <button type="button" className={`side-toggle-btn${state.mySide === 'red'  ? ' active' : ''}`} onClick={() => setSide('red')}>레드팀</button>
        </div>
      </header>

      {/* Pick order strip */}
      <div className="pick-order-strip">
        {PICK_ORDER.map((step, i) => (
          <span key={step.num} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <div className={`pick-order-step team-${step.team}${step.num === state.pickPhaseGlobal ? ' current' : ''}`}>
              <div className="num">{step.num}</div>
              <div className="team">{step.label}</div>
            </div>
            {i < PICK_ORDER.length - 1 && <div className="pick-order-arrow">→</div>}
          </span>
        ))}
      </div>

      {/* Bans */}
      <div className="ban-slots-row">
        <span className="ban-team-label blue">우리팀 밴</span>
        {[0,1,2,3,4].map((i) => (
          <button
            key={`my-ban-${i}`}
            type="button"
            className={`ban-slot-v3${state.myBans[i] ? ' filled' : ''}`}
            onClick={() => setModalFor({ kind: 'ban', side: 'my', idx: i })}
          >
            {state.myBans[i] ? <ChampionIcon championKey={state.myBans[i]} size={28} /> : '+'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="ban-team-label red">적팀 밴</span>
        {[0,1,2,3,4].map((i) => (
          <button
            key={`enemy-ban-${i}`}
            type="button"
            className={`ban-slot-v3${state.enemyBans[i] ? ' filled' : ''}`}
            onClick={() => setModalFor({ kind: 'ban', side: 'enemy', idx: i })}
          >
            {state.enemyBans[i] ? <ChampionIcon championKey={state.enemyBans[i]} size={28} /> : '+'}
          </button>
        ))}
      </div>

      {/* Two teams */}
      <div className="pick-grid">
        {(['my', 'enemy'] as const).map((side) => {
          const team = side === 'my' ? state.myTeam : state.enemyTeam;
          const teamColor = side === 'my' ? myColor : enColor;
          const headerLabel = side === 'my' ? `우리팀 (${myColor === 'blue' ? '블루' : '레드'})` : `적팀 (${enColor === 'blue' ? '블루' : '레드'})`;
          const preds = result?.predictions?.[side] ?? [];
          return (
            <div key={side} className="card pick-team">
              <div className={`team-header ${teamColor}`}>{headerLabel}</div>
              <div className="pick-slots">
                {team.map((slot, i) => {
                  const slotPreds = preds[i] ?? [];
                  const hasPreds = !slot.champion && slotPreds.length > 0;
                  const cls = [
                    'pick-slot-v3',
                    `team-${physicalSideOf(side)}`,
                    slot.status === 'confirmed' ? 'confirmed' : '',
                    slot.status === 'intent' ? 'intent' : '',
                    slot.isMine ? 'is-mine' : '',
                    hasPreds ? 'has-predictions' : '',
                  ].filter(Boolean).join(' ');

                  const inferredLane = slot.champion && !slot.lane ? inferLane(slot.champion) : null;

                  return (
                    <div
                      key={i}
                      className={cls}
                      onClick={() => setModalFor({ kind: 'pick', side, idx: i })}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="slot-pick-num">{pickNumLabel(side, slot.pickOrder)}</span>
                      {side === 'my' && (
                        <span
                          className="slot-mine-star"
                          title="내 자리 토글"
                          onClick={(e) => { e.stopPropagation(); toggleMine(i); }}
                        >
                          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                            <path d="M8 1l2.09 4.24 4.68.68-3.39 3.3.8 4.66L8 11.66 3.82 13.88l.8-4.66L1.23 5.92l4.68-.68z"/>
                          </svg>
                        </span>
                      )}
                      <div className="slot-content">
                        {slot.champion ? (
                          <>
                            <ChampionIcon championKey={slot.champion} size={48} alt={data.nameKr(slot.champion)} />
                            <div className="slot-champ-name">{data.nameKr(slot.champion)}</div>
                            {inferredLane && (
                              <div className="slot-lane inferred">(추정 {laneKr(inferredLane)})</div>
                            )}
                          </>
                        ) : (
                          <div className="slot-empty-text">+ 챔프 추가</div>
                        )}
                      </div>

                      <div className="slot-lane-select-wrap" onClick={(e) => e.stopPropagation()}>
                        <select
                          className="slot-lane-select"
                          title="라인 선택"
                          value={slot.lane ?? ''}
                          onChange={(e) => setTeamSlot(side, i, { lane: (e.target.value || undefined) as Lane | undefined })}
                        >
                          <option value="">라인 선택</option>
                          {ALL_LANES.map((ln) => <option key={ln} value={ln}>{laneKr(ln)}</option>)}
                        </select>
                      </div>

                      {hasPreds && (
                        <div className="slot-predictions">
                          <div className="slot-predictions-label">예상</div>
                          {slotPreds.slice(0, 3).map((p: any, k: number) => (
                            <div key={k} className="pred-row">
                              <ChampionIcon championKey={p.c} size={20} />
                              <span className="pred-name">{data.nameKr(p.c)}</span>
                              <span className="pred-prob">{Math.round(p.prob * 100)}%</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {slot.champion && (
                        <span
                          className="slot-status"
                          title="클릭: 확정 ↔ 의도"
                          onClick={(e) => { e.stopPropagation(); toggleStatus(side, i); }}
                        >
                          {slot.status === 'confirmed' ? '확정' : '의도'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scenario */}
      {result && (
        <div className="card scenario-card">
          <span className="scenario-label">감지된 시나리오</span>
          <span className="scenario-name">{SCENARIO_KR[result.meta.scenario] ?? result.meta.scenario}</span>
          <span className="scenario-weights">
            M:{result.meta.weights.M} · C:{result.meta.weights.C} · S:{result.meta.weights.S} · B:{result.meta.weights.B} · R:{result.meta.weights.R} · I:{result.meta.weights.I}
          </span>
        </div>
      )}

      <div className="pick-page-grid">
        <div>
          {/* Composition */}
          {result && <CompositionCard composition={result.composition} engine={engine} />}

          {/* Recommendations */}
          <h2 className="section-title" style={{ marginTop: 'var(--space-4)' }}>
            <span>추천 챔프 <span className="text-tertiary fw-medium" style={{ fontSize: 11 }}>15개</span></span>
            <span className="meta">패치 {result?.meta?.patch ?? data.PATCH} · {result?.meta?.tierBracket ?? data.BRACKET}</span>
          </h2>
          <div className="pick-recommend-grid">
            {!result || result.candidates.length === 0 ? (
              <div className="card" style={{ gridColumn: '1/-1', padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
                본인 자리(★)와 라인을 입력하면 추천이 표시됩니다.
              </div>
            ) : (
              result.candidates.map((c: any) => (
                <RecommendCard key={c.champion} candidate={c} nameKr={data.nameKr} />
              ))
            )}
          </div>
        </div>

        <aside>
          <div className="card ban-suggestions-card">
            <div className="section-title">
              <span>추천 밴</span>
              <span className="meta">메타 OP</span>
            </div>
            <div>
              {(result?.banSuggestions ?? []).map((b: any, i: number) => (
                <div key={b.champion} className="ban-suggestion-row">
                  <span className="rank">{i + 1}</span>
                  <ChampionIcon championKey={b.champion} size={32} alt={data.nameKr(b.champion)} />
                  <div className="info">
                    <div className="name">{data.nameKr(b.champion)}</div>
                    <div className="reason">{b.reason}</div>
                  </div>
                  <div className="op">{b.opScore}</div>
                </div>
              ))}
            </div>
            <p className="text-tertiary" style={{ fontSize: 10, marginTop: 'var(--space-2)', lineHeight: 1.5 }}>
              winrate × pickrate × √banrate 기준. 픽 추천과 별개의 단순 정렬입니다.
            </p>
          </div>
        </aside>
      </div>

      {modalFor && (
        <ChampionPickerModal
          target={modalFor}
          data={data}
          state={state}
          onClose={() => setModalFor(null)}
          onPick={(champion) => {
            if (modalFor.kind === 'ban') setBan(modalFor.side, modalFor.idx, champion);
            else setPick(modalFor.side, modalFor.idx, champion);
            setModalFor(null);
          }}
          onClear={() => {
            if (modalFor.kind === 'ban') setBan(modalFor.side, modalFor.idx, undefined);
            else setPick(modalFor.side, modalFor.idx, undefined);
            setModalFor(null);
          }}
        />
      )}
    </>
  );
}

// ---- Subcomponents ------------------------------------------------------

function CompositionCard({ composition: c, engine }: { composition: any; engine: ReturnType<typeof createPickEngine> }) {
  const rows = [
    { label: 'AD/AP', value: `AD ${c.adShare}% / AP ${c.apShare}%`, bar: c.adShare, gap: c.gaps.some((g: any) => g.type === 'ad' || g.type === 'ap') },
    { label: '하드 CC', value: `${c.hardCcCount}건 (목표 ${c.ccTarget}+)`, bar: Math.min(100, (c.hardCcCount / c.ccTarget) * 100), gap: c.hardCcCount < c.ccTarget },
    { label: '탱/브루저', value: `${(c.tankCount + c.bruiserCount).toFixed(1)}명`, bar: Math.min(100, (c.tankCount + c.bruiserCount) * 50), gap: c.gaps.some((g: any) => g.type === 'tank') },
    { label: '이니시', value: c.engageType === 'none' ? '없음' : c.engageType === 'hard' ? '하드' : c.engageType === 'soft' ? '소프트' : '픽', bar: ({ none: 0, soft: 40, pick: 60, hard: 100 } as Record<string, number>)[c.engageType] ?? 0, gap: c.gaps.some((g: any) => g.type === 'engage') },
    { label: '웨클', value: `${c.waveClear}점`, bar: Math.min(100, c.waveClear * 10), gap: c.gaps.some((g: any) => g.type === 'waveClear') },
    { label: '후반 스케일', value: `초${c.scaling.early} 중${c.scaling.mid} 후${c.scaling.late}`, bar: Math.min(100, c.scaling.late * 25 + c.scaling.mid * 10), gap: c.gaps.some((g: any) => g.type === 'scaling') },
  ];

  return (
    <div className="card composition-card">
      <div className="section-title">
        <span>
          우리팀 컴포 분석
          {c.archetype !== 'unknown' && (
            <span className="archetype-pill" style={{ marginLeft: 8 }}>
              <span className="name">{engine.archetypeKr(c.archetype)}</span>
              {` (${Math.round(c.archetypeConfidence * 100)}%)`}
            </span>
          )}
        </span>
        <span className="meta">{c.filledSlots}슬롯 채움</span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className={`comp-row${row.gap ? ' gap' : ''}`}>
          <div className="comp-label">{row.label}</div>
          <div className="comp-bar-track">
            <div className="comp-bar-fill" style={{ width: `${row.bar}%` }} />
          </div>
          <div className="comp-value">{row.value}</div>
        </div>
      ))}
      {c.gaps.length > 0 && (
        <div className="comp-gap-list">
          {c.gaps.map((g: any, i: number) => (
            <div key={i} className="comp-gap-item">
              <span className={`severity-dot ${g.severity}`} />
              {g.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendCard({ candidate: c, nameKr }: { candidate: any; nameKr: (k: string) => string }) {
  const breakdownItems: Array<[string, number]> = [
    ['카운터', c.breakdown.C],
    ['메타',   c.breakdown.M],
    ['시너지', c.breakdown.S],
    ['밸런스', c.breakdown.B],
    ['선픽안전', c.breakdown.R],
    ['의도',   c.breakdown.I],
  ];
  const m = c.masteryInfo;
  const diffKr = ({ easy: '쉬움', medium: '중간', hard: '어려움', insane: '매우 어려움' } as Record<string, string>)[m.difficulty] ?? m.difficulty;

  return (
    <div className={`recommend-card v3${c.isBanned ? ' banned' : ''}`}>
      {c.isBanned && (
        <span className="banned-label">{c.bannedBy === 'us' ? 'BANNED (우리)' : 'BANNED (적)'}</span>
      )}
      <div className="head">
        <ChampionIcon championKey={c.champion} size={48} alt={nameKr(c.champion)} />
        <div style={{ flex: 1 }}>
          <div className="name">{nameKr(c.champion)}</div>
        </div>
        <div className="meta">
          <div className="score">{c.score}</div>
        </div>
      </div>
      <div className="breakdown-bars">
        {breakdownItems.map(([label, val]) => {
          const v = Number(val) || 0;
          const widthPct = Math.min(100, Math.abs(v) * 4);
          return (
            <div key={label} className={`row${v < 0 ? ' neg' : ''}`}>
              <div>{label}</div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${widthPct}%` }} />
              </div>
              <div>{v >= 0 ? '+' : ''}{v}</div>
            </div>
          );
        })}
      </div>
      <div className="reason-text">{c.reasonText}</div>
      {c.reasonTags?.length > 0 && (
        <div className="reason-tags">
          {c.reasonTags.map((t: string, i: number) => <span key={i} className="reason-tag">{t}</span>)}
        </div>
      )}
      <div className="mastery-info">
        <span className={`diff-${m.difficulty}`}>{diffKr}</span>
        ·
        {m.message}
        <span style={{ marginLeft: 'auto' }}>본인 {m.seasonGames}판</span>
      </div>
    </div>
  );
}

function ChampionPickerModal({
  target, data, state, onClose, onPick, onClear,
}: {
  target: ModalTarget;
  data: PickData;
  state: DraftState;
  onClose: () => void;
  onPick: (champion: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const usedChampions = useMemo(() => {
    const set = new Set<string>();
    state.myTeam.forEach((s) => { if (s.champion) set.add(s.champion); });
    state.enemyTeam.forEach((s) => { if (s.champion) set.add(s.champion); });
    state.myBans.forEach((c) => set.add(c));
    state.enemyBans.forEach((c) => set.add(c));
    return set;
  }, [state]);

  const champs = useMemo(() => {
    const q = query.toLowerCase().trim();
    return Object.keys(data.CHAMPIONS)
      .filter((c) => {
        if (!q) return true;
        const meta = data.CHAMPIONS[c];
        return c.toLowerCase().includes(q) || meta.nameKr.includes(q);
      })
      .sort((a, b) => data.nameKr(a).localeCompare(data.nameKr(b), 'ko'));
  }, [data, query]);

  return (
    <div className="champ-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="champ-modal" role="dialog" aria-modal="true">
        <h2 className="sr-only">챔피언 선택</h2>
        <div className="champ-modal-head">
          <input
            type="text"
            placeholder="챔프 검색 (한글/영문)"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="champ-modal-body">
          <div className="champ-modal-grid">
            {champs.map((c) => {
              const used = usedChampions.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  className="champ-modal-tile"
                  disabled={used}
                  onClick={() => onPick(c)}
                  style={{ opacity: used ? 0.3 : 1 }}
                >
                  <ChampionIcon championKey={c} size={48} alt={data.nameKr(c)} />
                  <div className="name">{data.nameKr(c)}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="champ-modal-foot">
          <button type="button" onClick={onClear}>슬롯 비우기</button>
          <button type="button" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}
