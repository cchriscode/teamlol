'use client';

// Build tab — self only: item purchases + skill order + rune page.
// Extracted from match-list-client.tsx so it's dynamic-imported and excluded
// from the initial summoner-page client bundle.

import { useState, useEffect } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import { laneKr } from '@/lib/display';
import type { MatchListItem } from '@/lib/api-types-summoner';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type Participant = NonNullable<MatchListItem['participants']>[number];

interface BuildParticipant {
  slot: number;
  itemEvents?: Array<{ ts: number; itemId: number; type: 'BUY' | 'SELL' | 'UNDO' }>;
  skillEvents?: Array<{ ts: number; skillSlot: 1 | 2 | 3 | 4 }>;
}
interface BuildTimelineResp { perPlayer: BuildParticipant[] }

interface RunesFull {
  primaryStyle: number | null;
  subStyle: number | null;
  perks: Array<{ id: number; iconPath: string | null; treeKey: string | null }>;
  statPerks: { offense?: number; flex?: number; defense?: number } | null;
}
const STAT_PERK_LABEL: Record<number, string> = {
  5001: 'HP', 5002: 'AR', 5003: 'MR',
  5005: '공속', 5007: '쿨감', 5008: '적응',
  5010: '이속', 5011: 'HP', 5013: '강인함',
};

interface Props {
  matchId: string;
  match: MatchListItem;
  selfPuuid: string;
  version: string;
  championNameByKey: Record<string, string>;
}

export default function BuildTab({ matchId, match, selfPuuid, version, championNameByKey }: Props) {
  const [data, setData] = useState<BuildTimelineResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/match/${encodeURIComponent(matchId)}/timeline-summary`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('no timeline')))
      .then((j) => { if (alive) setData(j as BuildTimelineResp); })
      .catch((e) => { if (alive) setError(e.message ?? '오류'); });
    return () => { alive = false; };
  }, [matchId]);

  if (error) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>빌드 데이터 없음</div>;
  if (!data) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>로딩 중...</div>;

  const selfParticipant = (match.participants ?? []).find((p) => p.puuid === selfPuuid);
  const selfSlot = (selfParticipant as Participant & { slot?: number } | undefined)?.slot;
  const buildBySlot = new Map<number, BuildParticipant>();
  for (const b of data.perPlayer ?? []) buildBySlot.set(b.slot, b);
  const bp = selfSlot != null ? buildBySlot.get(selfSlot) : undefined;
  const items  = (bp?.itemEvents ?? []).filter((e) => e.type === 'BUY');
  const skills = bp?.skillEvents ?? [];
  const champName = championNameByKey[match.self.championKey] ?? match.self.championKey;

  return (
    <div className="build-self" onClick={(e) => e.stopPropagation()}>
      <div className="build-self-head">
        <ChampionIcon championKey={match.self.championKey} size={40} version={version} alt={champName} />
        <div>
          <div className="build-self-name">{champName}</div>
          <div className="text-tertiary" style={{ fontSize: 11 }}>{laneKr(match.self.lane)}</div>
        </div>
      </div>

      <div className="build-section">
        <div className="build-section-label">아이템 빌드</div>
        {items.length === 0 ? (
          <div className="text-tertiary" style={{ fontSize: 11 }}>아이템 기록 없음</div>
        ) : (
          <div className="build-item-row">
            {items.map((e, k) => (
              <div key={k} className="build-item">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="item-icon" src={ddragon.itemIcon(e.itemId, version)} width={32} height={32} alt="" />
                <div className="build-item-ts">{Math.floor(e.ts / 60)}분</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="build-section">
        <div className="build-section-label">스킬 빌드</div>
        {skills.length === 0 ? (
          <div className="text-tertiary" style={{ fontSize: 11 }}>스킬 기록 없음</div>
        ) : (
          <SkillBuildGrid skills={skills} />
        )}
      </div>

      <div className="build-section">
        <div className="build-section-label">룬</div>
        {!match.self.runesFull ? (
          <div className="text-tertiary" style={{ fontSize: 11 }}>룬 기록 없음</div>
        ) : (
          <RunePage runesFull={match.self.runesFull as RunesFull} />
        )}
      </div>
    </div>
  );
}

function SkillBuildGrid({ skills }: { skills: Array<{ ts: number; skillSlot: 1 | 2 | 3 | 4 }> }) {
  const sequence = skills.slice(0, 18);
  const labelOf: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };
  return (
    <div className="skill-build">
      <div className="skill-build-grid">
        {[1, 2, 3, 4].map((s) => (
          <div key={`label-${s}`} className={`skill-build-rowlabel skill-${s}`} style={{ gridRow: s, gridColumn: 1 }}>
            {labelOf[s]}
          </div>
        ))}
        {Array.from({ length: 18 }, (_, i) => i + 1).map((lv) => {
          const chosen = sequence[lv - 1]?.skillSlot;
          return [1, 2, 3, 4].map((s) => (
            <div
              key={`cell-${lv}-${s}`}
              className={`skill-build-cell skill-${s}${chosen === s ? ' chosen' : ''}`}
              style={{ gridRow: s, gridColumn: lv + 1 }}
            >
              {chosen === s ? lv : ''}
            </div>
          ));
        })}
      </div>
    </div>
  );
}

function RunePage({ runesFull }: { runesFull: RunesFull }) {
  const primary = runesFull.perks.slice(0, 4);
  const sub     = runesFull.perks.slice(4, 6);
  return (
    <div className="rune-page">
      <div className="rune-page-col">
        <div className="rune-page-col-head">
          {runesFull.primaryStyle != null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ddragon.runeStyleIcon(runesFull.primaryStyle)} width={20} height={20} alt="" />
          )}
          <span className="rune-page-col-label">주 룬</span>
        </div>
        <div className="rune-page-perks">
          {primary.map((p, i) => (
            <div key={i} className={`rune-page-perk${i === 0 ? ' keystone' : ''}`}>
              {p.iconPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ddragon.runeIcon(p.iconPath)} width={i === 0 ? 36 : 26} height={i === 0 ? 36 : 26} alt="" />
              ) : <span className="text-tertiary">?</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="rune-page-col">
        <div className="rune-page-col-head">
          {runesFull.subStyle != null && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ddragon.runeStyleIcon(runesFull.subStyle)} width={20} height={20} alt="" />
          )}
          <span className="rune-page-col-label">보조 룬</span>
        </div>
        <div className="rune-page-perks">
          {sub.map((p, i) => (
            <div key={i} className="rune-page-perk">
              {p.iconPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ddragon.runeIcon(p.iconPath)} width={26} height={26} alt="" />
              ) : <span className="text-tertiary">?</span>}
            </div>
          ))}
        </div>
        {runesFull.statPerks && (
          <div className="rune-page-stats">
            {(['offense', 'flex', 'defense'] as const).map((k) => {
              const id = runesFull.statPerks?.[k];
              return (
                <div key={k} className="rune-page-stat">
                  {id ? (STAT_PERK_LABEL[id] ?? id) : '—'}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
