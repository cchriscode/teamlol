'use client';

import { useMemo, useState } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { createPickEngine } from '@/lib/pick-engine';
import type { PickData, DraftState, SlotState, Lane } from '@/lib/pick-types';

const LANES: Lane[] = ['top', 'jungle', 'mid', 'adc', 'support'];
const LANE_KR: Record<Lane, string> = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' };

function emptySlots(prefix: 'my' | 'enemy', isMineFlagOn: boolean): SlotState[] {
  return Array.from({ length: 5 }, (_, i) => ({
    pickOrder: i + 1,
    status: 'empty' as const,
    isMine: isMineFlagOn && i === 0,
  }));
}

function initialState(): DraftState {
  return {
    pickPhaseGlobal: 1,
    myTeam: emptySlots('my', true),
    enemyTeam: emptySlots('enemy', false),
    myBans: [],
    enemyBans: [],
    mySide: 'blue',
  };
}

interface Props {
  initialData: PickData;
}

export function PickRecommendApp({ initialData }: Props) {
  const data = useMemo(() => {
    // Re-attach the helper function lost during server-serialization.
    return {
      ...initialData,
      nameKr: (key: string) => initialData.CHAMPIONS[key]?.nameKr ?? key,
    } as PickData;
  }, [initialData]);

  const engine = useMemo(() => createPickEngine(data), [data]);
  const [state, setState] = useState<DraftState>(initialState);
  const [pickerOpenFor, setPickerOpenFor] = useState<{ side: 'my' | 'enemy'; idx: number } | null>(null);

  const result = useMemo(() => {
    try {
      return engine.recommend(state);
    } catch {
      return null;
    }
  }, [engine, state]);

  const update = (next: Partial<DraftState>) => setState((prev) => ({ ...prev, ...next }));

  const setSlotChampion = (side: 'my' | 'enemy', idx: number, champion: string | undefined) => {
    setState((prev) => {
      const team = side === 'my' ? [...prev.myTeam] : [...prev.enemyTeam];
      team[idx] = { ...team[idx], champion, status: champion ? 'confirmed' : 'empty' };
      return { ...prev, [side === 'my' ? 'myTeam' : 'enemyTeam']: team };
    });
  };

  const setSlotLane = (side: 'my' | 'enemy', idx: number, lane: Lane | '') => {
    setState((prev) => {
      const team = side === 'my' ? [...prev.myTeam] : [...prev.enemyTeam];
      team[idx] = { ...team[idx], lane: lane || undefined };
      return { ...prev, [side === 'my' ? 'myTeam' : 'enemyTeam']: team };
    });
  };

  const toggleMine = (idx: number) => {
    setState((prev) => ({
      ...prev,
      myTeam: prev.myTeam.map((s, i) => ({ ...s, isMine: i === idx })),
    }));
  };

  const toggleSide = () => update({ mySide: state.mySide === 'blue' ? 'red' : 'blue' });

  const allChampionKeys = useMemo(
    () => Object.keys(data.CHAMPIONS).sort((a, b) => data.nameKr(a).localeCompare(data.nameKr(b), 'ko')),
    [data],
  );

  const usedChampions = new Set([
    ...state.myTeam.map((s) => s.champion).filter(Boolean) as string[],
    ...state.enemyTeam.map((s) => s.champion).filter(Boolean) as string[],
  ]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="filter-label">우리팀 사이드</span>
        <button type="button" className="filter-chip" onClick={toggleSide}>
          {state.mySide === 'blue' ? '블루' : '레드'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {(['my', 'enemy'] as const).map((side) => {
          const team = side === 'my' ? state.myTeam : state.enemyTeam;
          const teamColor = (side === 'my') === (state.mySide === 'blue') ? 'var(--color-win)' : 'var(--color-loss)';
          const label = side === 'my' ? '우리팀' : '적팀';
          return (
            <div key={side} className="card" style={{ padding: 12, borderLeft: `3px solid ${teamColor}` }}>
              <div className="section-title"><span>{label}</span></div>
              <div style={{ display: 'grid', gap: 8 }}>
                {team.map((slot, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto',
                      gap: 8,
                      alignItems: 'center',
                      padding: 8,
                      background: 'var(--bg-elevated)',
                      borderRadius: 6,
                    }}
                  >
                    {side === 'my' && (
                      <button
                        type="button"
                        title="내 슬롯"
                        onClick={() => toggleMine(i)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: slot.isMine ? 'var(--color-warning)' : 'var(--text-quaternary)',
                          cursor: 'pointer',
                          fontSize: 18,
                        }}
                      >★</button>
                    )}
                    <button
                      type="button"
                      onClick={() => setPickerOpenFor({ side, idx: i })}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {slot.champion ? (
                        <>
                          <ChampionIcon championKey={slot.champion} size={32} />
                          <span>{data.nameKr(slot.champion)}</span>
                        </>
                      ) : (
                        <span className="text-tertiary">+ 챔프 추가</span>
                      )}
                    </button>
                    <select
                      className="region-select"
                      value={slot.lane ?? ''}
                      onChange={(e) => setSlotLane(side, i, e.target.value as Lane | '')}
                      style={{ minWidth: 80 }}
                    >
                      <option value="">라인</option>
                      {LANES.map((ln) => (
                        <option key={ln} value={ln}>{LANE_KR[ln]}</option>
                      ))}
                    </select>
                    {slot.champion && (
                      <button
                        type="button"
                        className="filter-chip"
                        onClick={() => setSlotChampion(side, i, undefined)}
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {result && result.candidates.length > 0 && (
        <div className="card" style={{ padding: 16 }}>
          <div className="section-title">
            <span>추천 챔프</span>
            <span className="meta">★ 슬롯 기준 · 점수 높은 순 top 15</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginTop: 12 }}>
            {result.candidates.slice(0, 15).map((c) => (
              <div
                key={c.champion}
                style={{
                  padding: 12,
                  background: 'var(--bg-elevated)',
                  borderRadius: 6,
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: 8,
                  alignItems: 'center',
                  opacity: c.isBanned ? 0.4 : 1,
                }}
              >
                <ChampionIcon championKey={c.champion} size={40} />
                <div>
                  <div className="fw-medium">{data.nameKr(c.champion)}</div>
                  <div className="text-tertiary" style={{ fontSize: 11 }}>{c.reasonText}</div>
                </div>
                <div className="stat-cell primary" style={{ fontSize: 18, fontWeight: 600 }}>
                  {c.score}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pickerOpenFor && (
        <div
          onClick={() => setPickerOpenFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="card"
            style={{ padding: 16, maxWidth: 720, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}
          >
            <div className="section-title"><span>챔피언 선택</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 6, marginTop: 12 }}>
              {allChampionKeys.map((key) => {
                const used = usedChampions.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={used}
                    onClick={() => {
                      setSlotChampion(pickerOpenFor.side, pickerOpenFor.idx, key);
                      setPickerOpenFor(null);
                    }}
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 4,
                      padding: 4,
                      cursor: used ? 'not-allowed' : 'pointer',
                      opacity: used ? 0.3 : 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                    }}
                  >
                    <ChampionIcon championKey={key} size={48} />
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{data.nameKr(key)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
