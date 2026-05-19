'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
import { spellKey } from '@/lib/summoner-spells';
import { laneKr, timeAgo, displayName } from '@/lib/display';
import type { MatchListItem } from '@/lib/api-types-summoner';

// Lazy-load expand-tab modules — they're only needed once a user clicks into
// a match card. Excluding them from the initial summoner page bundle keeps
// the critical path light.
const TimelineTab = dynamic(() => import('./match-timeline-tab'), {
  loading: () => <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>로딩 중...</div>,
});
const BuildTab = dynamic(() => import('./match-build-tab'), {
  loading: () => <div className="text-tertiary" style={{ padding: 32, textAlign: 'center' }}>로딩 중...</div>,
});

interface Props {
  matches: MatchListItem[];
  selfPuuid: string;
  version: string;
  championNameByKey: Record<string, string>;
  region: string;
  cold?: boolean;
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
                    <img key={i} className={`item-icon${i === 6 ? ' trinket' : ''}`} src={ddragon.itemIcon(id, version)} width={22} height={22} alt="" />
                  ) : null)}
                  {s.roleBoundItem ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="item-icon role-bound" src={ddragon.itemIcon(s.roleBoundItem, version)} width={22} height={22} alt="" title="역할 전용 아이템" />
                  ) : null}
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
        <BuildTab matchId={m.matchId} match={m} version={version}
                  selfPuuid={selfPuuid} championNameByKey={championNameByKey} />
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
  // Global rank by AI score across all 10 players (1등 = best in the match).
  const rankByPuuid = new Map<string, number>();
  [...blueParts, ...redParts]
    .sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1))
    .forEach((p, i) => rankByPuuid.set(p.puuid, i + 1));
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
            const rk = rankByPuuid.get(p.puuid) ?? 0;
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
                    <img key={i} className={`item-icon${i === 6 ? ' trinket' : ''}`} src={ddragon.itemIcon(id, version)} width={22} height={22} alt="" />
                  ) : (
                    <span key={i} className="item-icon empty" />
                  ))}
                  {p.roleBoundItem ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="item-icon role-bound" src={ddragon.itemIcon(p.roleBoundItem, version)} width={22} height={22} alt="" title="역할 전용 아이템" />
                  ) : null}
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

// BuildTab + TimelineTab live in sibling files (lazy-loaded via next/dynamic).


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
