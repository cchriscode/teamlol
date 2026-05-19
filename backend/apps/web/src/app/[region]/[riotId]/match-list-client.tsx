'use client';

import { useState, useEffect } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import { spellKey } from '@/lib/summoner-spells';
import type { MatchListItem } from '@/lib/api-types-summoner';

interface Props {
  matches: MatchListItem[];
  selfPuuid: string;
  version: string;
  championNameByKey: Record<string, string>;
  region: string;
  cold?: boolean;
}

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

// Render-time name lookup honouring the anonymous toggle (still shows self).
function displayName(p: { puuid: string; nameKr?: string; gameName?: string }, selfPuuid: string, anonymous: boolean): string {
  if (anonymous && p.puuid !== selfPuuid) return '소환사 ' + p.puuid.slice(0, 4).toUpperCase();
  return p.nameKr ?? p.gameName ?? p.puuid.slice(0, 6);
}
function timeAgo(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const m = Math.floor(sec / 60); if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function MatchListClient({ matches, selfPuuid, version, championNameByKey, cold }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<'all' | 'solo'>('all');
  const [champQuery, setChampQuery] = useState('');
  const [anonymous, setAnonymous] = useState(false);

  // Filter pipeline: queue → champion name substring.
  const filtered = matches.filter((m) => {
    if (queueFilter === 'solo' && m.queueId !== 420) return false;
    if (champQuery.trim()) {
      const q = champQuery.trim().toLowerCase();
      const k = m.self.championKey.toLowerCase();
      const kr = (championNameByKey[m.self.championKey] ?? '').toLowerCase();
      if (!k.includes(q) && !kr.includes(q)) return false;
    }
    return true;
  });

  if (matches.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        {cold ? '데이터 수집 중입니다. 잠시 후 새로고침하세요.' : '아직 수집된 매치가 없습니다.'}
      </div>
    );
  }

  return (
    <>
      <div className="match-toolbar">
        <div className="match-toolbar-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={queueFilter === 'all'}
                  className={`filter-chip${queueFilter === 'all' ? ' active' : ''}`}
                  onClick={() => setQueueFilter('all')}>전체</button>
          <button type="button" role="tab" aria-selected={queueFilter === 'solo'}
                  className={`filter-chip${queueFilter === 'solo' ? ' active' : ''}`}
                  onClick={() => setQueueFilter('solo')}>솔로랭크</button>
        </div>
        <div className="match-toolbar-actions">
          <input
            type="text"
            placeholder="챔피언 검색"
            className="match-champ-search"
            value={champQuery}
            onChange={(e) => setChampQuery(e.target.value)}
          />
          <button type="button" className="filter-chip" onClick={() => setAnonymous((v) => !v)}
                  aria-pressed={anonymous}>
            {anonymous ? '소환사명 표시' : '소환사명 숨기기'}
          </button>
          <ShareButton />
        </div>
      </div>
      {filtered.length === 0 && (
        <div className="card" style={{ padding: 16, textAlign: 'center', color: 'var(--text-tertiary)' }}>
          필터에 맞는 매치가 없습니다.
        </div>
      )}
      {filtered.map((m) => {
        const s = m.self;
        const kda = s.deaths === 0 ? s.kills + s.assists : (s.kills + s.assists) / s.deaths;
        const minutes = Math.floor(m.gameDuration / 60);
        const seconds = m.gameDuration % 60;
        const cspm = m.gameDuration > 0 ? s.cs / (m.gameDuration / 60) : 0;
        const isOpen = expandedId === m.matchId;

        const blueParts = (m.participants ?? []).filter((p) => p.team === 'blue');
        const redParts  = (m.participants ?? []).filter((p) => p.team === 'red');

        return (
          <div key={m.matchId}>
            <div
              role="button"
              tabIndex={0}
              className={`match-card${s.win ? ' win' : ''}${isOpen ? ' open' : ''}`}
              onClick={() => setExpandedId(isOpen ? null : m.matchId)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(isOpen ? null : m.matchId); } }}
            >
              <div className={`match-result${s.win ? ' win' : ''}`}>
                <div className="match-result-label">{s.win ? '승리' : '패배'}</div>
                <div className="match-meta">
                  솔로랭크<br />
                  {timeAgo(m.gameCreation)}<br />
                  {minutes}분 {seconds}초
                </div>
              </div>
              <div className="match-champ-section">
                <div className="match-champ-icon-wrap">
                  <ChampionIcon championKey={s.championKey} size={48} version={version} alt={championNameByKey[s.championKey] ?? s.championKey} />
                  <div className="match-position-badge">{laneKr(s.lane)}</div>
                </div>
                <RuneSpellStack
                  spells={s.spells}
                  keystoneIcon={s.keystoneIcon ?? null}
                  subStyleId={s.subStyleId ?? null}
                  version={version}
                />
              </div>
              <div className="match-stats">
                <div className="match-kda">{s.kills} / {s.deaths} / {s.assists} <span className="match-kda-ratio">(KDA {kda.toFixed(2)})</span></div>
                <div className="match-substats">CS {s.cs} ({cspm.toFixed(1)}/분) · 시야 {s.visionScore}</div>
                <div className="match-items">
                  {s.items.map((id, i) => id > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} className="item-icon" src={ddragon.itemIcon(id, version)} width={22} height={22} alt="" />
                  ) : null)}
                </div>
              </div>
              <div className="match-score-box">
                <div className="match-score-label">AI Score</div>
                <div className={`match-score-value${s.aiScore != null && s.aiScore >= 60 ? ' high' : s.aiScore != null && s.aiScore <= 40 ? ' low' : ''}`}>
                  {s.aiScore?.toFixed(0) ?? '—'}
                </div>
                {s.aiScoreLetter && (
                  <div style={{ fontSize: 10, marginTop: 2 }}>{s.aiScoreLetter}</div>
                )}
              </div>
              {m.participants && m.participants.length === 10 && (
                <div className="match-teams">
                  <div className="match-teams-grid">
                    {[blueParts, redParts].map((team, idx) => (
                      <div key={idx} className="match-teams-col">
                        <div className="team-label">{idx === 0 ? '블루팀' : '레드팀'}</div>
                        {team.map((p) => (
                          <div key={p.puuid} className={`player${p.puuid === selfPuuid ? ' is-self' : ''}`}>
                            <ChampionIcon championKey={p.championKey} size={14} alt="" />
                            <span className="player-name">{displayName(p, selfPuuid, anonymous)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="match-expand" aria-label={isOpen ? '접기' : '펼치기'}>{isOpen ? '▴' : '▾'}</div>
            </div>

            {isOpen && m.participants && m.participants.length === 10 && (
              <ExpandPanel
                match={m}
                blueParts={blueParts}
                redParts={redParts}
                selfPuuid={selfPuuid}
                version={version}
                championNameByKey={championNameByKey}
                anonymous={anonymous}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// ---- Expand panel: tabs (기본 분석 / 시간대별 분석) -------------------
// Replaces the original prototype's three-tab panel. "빌드" tab is a follow-
// up; timeline tab fetches `/api/match/:id/timeline-summary` lazily so
// expanding a card doesn't pay the cost until you click into the chart.
type Tab = 'basic' | 'timeline' | 'build';

type Participant = NonNullable<MatchListItem['participants']>[number];

interface ExpandPanelProps {
  match: MatchListItem;
  blueParts: Participant[];
  redParts: Participant[];
  selfPuuid: string;
  version: string;
  championNameByKey: Record<string, string>;
  anonymous: boolean;
}

function ExpandPanel({ match: m, blueParts, redParts, selfPuuid, version, championNameByKey, anonymous }: ExpandPanelProps) {
  const [tab, setTab] = useState<Tab>('basic');

  return (
    <div className="match-expand-panel-wrap card">
      <div className="expand-tabs" role="tablist">
        {([
          { k: 'basic', label: '기본 분석' },
          { k: 'timeline', label: '시간대별 분석' },
          { k: 'build', label: '빌드' },
        ] as Array<{ k: Tab; label: string }>).map((t) => (
          <button
            key={t.k}
            type="button"
            role="tab"
            aria-selected={tab === t.k}
            className={`expand-tab${tab === t.k ? ' active' : ''}`}
            onClick={(e) => { e.stopPropagation(); setTab(t.k); }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'basic' && (
        <BasicTab
          blueParts={blueParts} redParts={redParts}
          selfPuuid={selfPuuid} version={version}
          championNameByKey={championNameByKey}
          anonymous={anonymous}
        />
      )}

      {tab === 'timeline' && (
        <TimelineTab matchId={m.matchId} duration={m.gameDuration} />
      )}

      {tab === 'build' && (
        <BuildTab matchId={m.matchId} match={m} duration={m.gameDuration} version={version}
                  participants={m.participants ?? []} selfPuuid={selfPuuid}
                  championNameByKey={championNameByKey} anonymous={anonymous} />
      )}
    </div>
  );
}

// --- Basic tab — vertical stacked scoreboard (winning team on top).
function BasicTab({ blueParts, redParts, selfPuuid, version, championNameByKey, anonymous }: {
  blueParts: Participant[]; redParts: Participant[]; selfPuuid: string;
  version: string; championNameByKey: Record<string, string>;
  anonymous: boolean;
}) {
  // Rank within team by AI score (1등/2등/...).
  const rankIn = (team: Participant[], puuid: string): number => {
    const sorted = [...team].sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1));
    return sorted.findIndex((p) => p.puuid === puuid) + 1;
  };
  // Highest dmg in the match — denominator for the dmg bar.
  const allDmg = [...blueParts, ...redParts].map((p) => p.dmgToChampPerMin ?? 0);
  const maxDmg = Math.max(1, ...allDmg);

  // Sort teams so winner appears first (matches the prototype layout).
  const teamA: { side: 'blue' | 'red'; players: Participant[]; win: boolean } = { side: 'blue', players: blueParts, win: !!blueParts[0]?.win };
  const teamB: { side: 'blue' | 'red'; players: Participant[]; win: boolean } = { side: 'red',  players: redParts,  win: !!redParts[0]?.win };
  const teams = [teamA, teamB].sort((a, b) => (b.win ? 1 : 0) - (a.win ? 1 : 0));

  return (
    <div className="scoreboard-stack" onClick={(e) => e.stopPropagation()}>
      {teams.map(({ side, players, win }) => (
        <div key={side} className={`scoreboard-team team-${side}${win ? ' win' : ' loss'}`}>
          <div className="scoreboard-team-head">
            <span className="scoreboard-result">{win ? '승리' : '패배'}</span>
            <span className="scoreboard-side">{side === 'blue' ? '블루팀' : '레드팀'}</span>
            <div className="scoreboard-head-cols">
              <span>AI 점수</span>
              <span>KDA</span>
              <span>피해량</span>
              <span>CS</span>
              <span>아이템</span>
            </div>
          </div>
          {players.map((p) => {
            const pkda = (p.deaths ?? 0) === 0
              ? ((p.kills ?? 0) + (p.assists ?? 0))
              : ((p.kills ?? 0) + (p.assists ?? 0)) / (p.deaths ?? 1);
            const rk = rankIn(players, p.puuid);
            const dmg = p.dmgToChampPerMin ?? 0;
            const dmgPct = (dmg / maxDmg) * 100;
            const aiScore = p.aiScore;
            const aiCls = aiScore == null ? '' : aiScore >= 65 ? 'ai-high' : aiScore < 40 ? 'ai-low' : 'ai-mid';
            return (
              <div key={p.puuid} className={`scoreboard-row${p.puuid === selfPuuid ? ' is-self' : ''}`}>
                <div className="sb-identity">
                  <RuneSpellStack spells={p.spells} keystoneIcon={p.keystoneIcon ?? null}
                                  subStyleId={p.subStyleId ?? null} version={version} compact />
                  <ChampionIcon championKey={p.championKey} size={32} version={version} alt={championNameByKey[p.championKey] ?? p.championKey} />
                  <div className="sb-name">
                    <div className="sb-name-line">
                      {displayName(p, selfPuuid, anonymous)}
                      {p.tagLine && !anonymous && <span className="text-tertiary"> #{p.tagLine}</span>}
                    </div>
                    <div className="sb-lane text-tertiary">{laneKr(p.lane ?? '')}</div>
                  </div>
                </div>
                <div className={`sb-ai ${aiCls}`}>
                  <div className="sb-ai-num">{aiScore != null ? Math.round(aiScore) : '—'}</div>
                  {rk > 0 && <div className="sb-ai-rank">{rk}등</div>}
                </div>
                <div className="sb-kda">
                  <div className="sb-kda-row">
                    <span className="kda-kills">{p.kills}</span>
                    <span className="text-tertiary"> / </span>
                    <span className="kda-deaths">{p.deaths}</span>
                    <span className="text-tertiary"> / </span>
                    <span className="kda-assists">{p.assists}</span>
                  </div>
                  <div className="sb-kda-ratio text-tertiary">{pkda.toFixed(2)} KDA</div>
                </div>
                <div className="sb-dmg">
                  <div className="sb-dmg-num">{Math.round(dmg).toLocaleString('ko-KR')}</div>
                  <div className="sb-dmg-bar">
                    <div className={`sb-dmg-bar-fill ${side}`} style={{ width: `${dmgPct}%` }} />
                  </div>
                </div>
                <div className="sb-cs">
                  <div className="sb-cs-num">{p.cs ?? 0}</div>
                  <div className="sb-cs-pm text-tertiary">{(p.csPerMin ?? 0).toFixed(1)}/분</div>
                </div>
                <div className="sb-items">
                  {(p.items ?? []).map((id, i) => id > 0 ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} className="item-icon" src={ddragon.itemIcon(id, version)} width={22} height={22} alt="" />
                  ) : (
                    <span key={i} className="item-icon empty" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- Rune + spell vertical stack (compact mode for scoreboard rows).
function RuneSpellStack({ spells, keystoneIcon, subStyleId, version, compact }: {
  spells?: number[]; keystoneIcon?: string | null; subStyleId?: number | null;
  version: string; compact?: boolean;
}) {
  const sz = compact ? 14 : 18;
  return (
    <div className={`rune-spell-stack${compact ? ' compact' : ''}`}>
      {keystoneIcon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="rune-icon" src={ddragon.runeIcon(keystoneIcon)} width={sz} height={sz} alt="" />
      )}
      {subStyleId != null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="rune-style-icon" src={ddragon.runeStyleIcon(subStyleId)} width={sz - 2} height={sz - 2} alt="" />
      )}
      {(spells ?? []).slice(0, 2).map((id, i) => {
        const k = spellKey(id);
        if (!k) return null;
        // eslint-disable-next-line @next/next/no-img-element
        return <img key={i} className="spell-icon" src={ddragon.spellIcon(k, version)} width={sz} height={sz} alt="" />;
      })}
    </div>
  );
}

// --- Build tab — self only: item purchases + skill order + rune page.
interface BuildParticipant {
  slot: number;
  itemEvents?: Array<{ ts: number; itemId: number; type: 'BUY' | 'SELL' | 'UNDO' }>;
  skillEvents?: Array<{ ts: number; skillSlot: 1 | 2 | 3 | 4 }>;
}
interface BuildTimelineResp { perPlayer: BuildParticipant[] }

function BuildTab({ matchId, match, selfPuuid, version, championNameByKey }: {
  matchId: string; duration: number; version: string;
  match: MatchListItem;
  participants: Participant[]; selfPuuid: string;
  championNameByKey: Record<string, string>;
  anonymous: boolean;
}) {
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

  // Find self slot — participants are sorted blue→red by slot, so isSelf flag is reliable.
  const selfParticipant = (match.participants ?? []).find((p) => p.puuid === selfPuuid);
  const selfSlot = (selfParticipant as Participant & { slot?: number } | undefined)?.slot;
  const buildBySlot = new Map<number, BuildParticipant>();
  for (const b of data.perPlayer ?? []) buildBySlot.set(b.slot, b);
  const bp = selfSlot != null ? buildBySlot.get(selfSlot) : undefined;
  const items   = (bp?.itemEvents ?? []).filter((e) => e.type === 'BUY');
  const skills  = bp?.skillEvents ?? [];
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
          <RunePage runesFull={match.self.runesFull} />
        )}
      </div>
    </div>
  );
}

// 18-cell grid: rows = Q/W/E/R, cols = champion level 1..18. Filled cell at
// (skill, level) marks the level-up choice.
function SkillBuildGrid({ skills }: { skills: Array<{ ts: number; skillSlot: 1 | 2 | 3 | 4 }> }) {
  // Build level taken at each level (1..18)
  const sequence = skills.slice(0, 18);
  const labelOf: Record<number, string> = { 1: 'Q', 2: 'W', 3: 'E', 4: 'R' };
  return (
    <div className="skill-build">
      <div className="skill-build-grid">
        {/* row headers */}
        {[1, 2, 3, 4].map((s) => (
          <div key={`label-${s}`} className={`skill-build-rowlabel skill-${s}`} style={{ gridRow: s, gridColumn: 1 }}>
            {labelOf[s]}
          </div>
        ))}
        {/* level cells */}
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

// ---- Timeline tab: lazy fetch + SVG line charts ----------------------
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

interface TimelineFrame {
  ts: number;
  blue: { totalGold: number; totalXp: number; kills: number };
  red:  { totalGold: number; totalXp: number; kills: number };
}
interface TimelineResp {
  frames: TimelineFrame[];
  events: Array<{ ts: number; type: string; teamId?: number }>;
}

function TimelineTab({ matchId, duration }: { matchId: string; duration: number }) {
  const [data, setData] = useState<TimelineResp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API_BASE}/api/match/${encodeURIComponent(matchId)}/timeline-summary`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error('no timeline')))
      .then((j) => { if (alive) setData(j as TimelineResp); })
      .catch((e) => { if (alive) setError(e.message ?? '오류'); });
    return () => { alive = false; };
  }, [matchId]);

  if (error) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>타임라인 데이터 없음</div>;
  if (!data) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>로딩 중...</div>;
  if (data.frames.length < 2) return <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>타임라인 표본 부족</div>;

  return (
    <div className="expand-timeline-stack" onClick={(e) => e.stopPropagation()}>
      <TimelineChart
        title="팀 골드"
        frames={data.frames}
        getValue={(f) => ({ blue: f.blue.totalGold, red: f.red.totalGold })}
        duration={duration}
      />
      <TimelineChart
        title="팀 경험치"
        frames={data.frames}
        getValue={(f) => ({ blue: f.blue.totalXp, red: f.red.totalXp })}
        duration={duration}
      />
      <TimelineChart
        title="팀 골드 격차 (블루 − 레드)"
        frames={data.frames}
        getValue={(f) => ({ blue: f.blue.totalGold - f.red.totalGold, red: 0 })}
        duration={duration}
        showRed={false}
        signed
      />
    </div>
  );
}

interface ChartProps {
  title: string;
  frames: TimelineFrame[];
  getValue: (f: TimelineFrame) => { blue: number; red: number };
  duration: number;
  showRed?: boolean;
  signed?: boolean;
}
function TimelineChart({ title, frames, getValue, duration, showRed = true, signed = false }: ChartProps) {
  const W = 720, H = 180, PAD = { l: 50, r: 16, t: 18, b: 28 };
  const blueVals = frames.map((f) => getValue(f).blue);
  const redVals  = frames.map((f) => getValue(f).red);
  const allVals  = showRed ? [...blueVals, ...redVals] : blueVals;
  const maxV = Math.max(...allVals, 1);
  const minV = signed ? Math.min(...allVals, -1) : 0;
  const yRange = maxV - minV || 1;
  const xScale = (ts: number) => PAD.l + (ts / Math.max(1, duration)) * (W - PAD.l - PAD.r);
  const yScale = (v: number) => H - PAD.b - ((v - minV) / yRange) * (H - PAD.t - PAD.b);
  const linePath = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xScale(frames[i].ts).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');

  // x-axis minute ticks (5 min steps, fewer if short game)
  const step = duration > 1800 ? 300 : 180;
  const xTicks: number[] = [];
  for (let s = 0; s <= duration; s += step) xTicks.push(s);

  // y-axis: 4 ticks
  const yTicks: number[] = [];
  for (let i = 0; i <= 4; i++) yTicks.push(minV + (yRange * i) / 4);
  const fmt = (v: number) => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;

  return (
    <div className="expand-chart">
      <div className="expand-chart-title-row">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
        {/* zero line for signed charts */}
        {signed && (
          <line x1={PAD.l} x2={W - PAD.r} y1={yScale(0)} y2={yScale(0)} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 3" />
        )}
        {/* y grid + labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yScale(v)} y2={yScale(v)} stroke="var(--border-subtle)" strokeWidth="1" />
            <text x={PAD.l - 6} y={yScale(v) + 3} fontSize="9" fill="var(--text-tertiary)" textAnchor="end">{fmt(v)}</text>
          </g>
        ))}
        {/* x labels */}
        {xTicks.map((s) => (
          <text key={s} x={xScale(s)} y={H - 10} fontSize="9" fill="var(--text-tertiary)" textAnchor="middle">
            {Math.round(s / 60)}분
          </text>
        ))}
        {/* lines */}
        <path d={linePath(blueVals)} fill="none" stroke="var(--color-win)" strokeWidth="2" />
        {showRed && <path d={linePath(redVals)} fill="none" stroke="var(--color-loss)" strokeWidth="2" />}
      </svg>
    </div>
  );
}

// --- Copy-current-URL share button. Web Share API → clipboard fallback.
function ShareButton() {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (typeof navigator !== 'undefined' && (navigator as Navigator & { share?: (data: ShareData) => Promise<void> }).share) {
        await (navigator as Navigator & { share: (data: ShareData) => Promise<void> }).share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // user cancelled or browser doesn't support; no-op
    }
  };
  return (
    <button type="button" className="filter-chip" onClick={onClick} aria-label="공유">
      {copied ? '복사됨' : '공유'}
    </button>
  );
}
