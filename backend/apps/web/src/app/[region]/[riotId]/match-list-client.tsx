'use client';

import { useState } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { ddragon } from '@/lib/ddragon';
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
function timeAgo(epochMs: number): string {
  const sec = Math.floor((Date.now() - epochMs) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const m = Math.floor(sec / 60); if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export function MatchListClient({ matches, selfPuuid, version, championNameByKey, cold }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (matches.length === 0) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        {cold ? '데이터 수집 중입니다. 잠시 후 새로고침하세요.' : '아직 수집된 매치가 없습니다.'}
      </div>
    );
  }

  return (
    <>
      {matches.map((m) => {
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
                            <span className="player-name">{p.nameKr ?? p.gameName ?? p.puuid.slice(0, 6)}</span>
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
              <div className="match-expand-panel">
                {[blueParts, redParts].map((team, idx) => (
                  <div key={idx} className={`match-detail-team team-${idx === 0 ? 'blue' : 'red'}`}>
                    <div className="match-detail-team-header">
                      {idx === 0 ? '블루팀' : '레드팀'} {team[0]?.win ? '승리' : '패배'}
                    </div>
                    {team.map((p) => {
                      const pkda = (p.deaths ?? 0) === 0
                        ? ((p.kills ?? 0) + (p.assists ?? 0))
                        : ((p.kills ?? 0) + (p.assists ?? 0)) / (p.deaths ?? 1);
                      return (
                        <div key={p.puuid} className={`match-detail-row${p.puuid === selfPuuid ? ' is-self' : ''}`}>
                          <ChampionIcon championKey={p.championKey} size={28} version={version} alt={championNameByKey[p.championKey] ?? p.championKey} />
                          <div className="match-detail-name">
                            <div className="name-line">
                              {p.nameKr ?? p.gameName ?? p.puuid.slice(0, 8)}
                              {p.tagLine && <span className="text-tertiary"> #{p.tagLine}</span>}
                            </div>
                            <div className="text-tertiary" style={{ fontSize: 10 }}>{laneKr(p.lane ?? '')}</div>
                          </div>
                          <div className="match-detail-kda">
                            {p.kills}/{p.deaths}/{p.assists}
                            <span className="text-tertiary" style={{ marginLeft: 4 }}>({pkda.toFixed(2)})</span>
                          </div>
                          <div className="match-detail-cs">
                            CS {p.cs ?? 0}
                            <span className="text-tertiary" style={{ marginLeft: 4 }}>({(p.csPerMin ?? 0).toFixed(1)}/분)</span>
                          </div>
                          <div className="match-detail-items">
                            {(p.items ?? []).map((id, i) => id > 0 ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={i} className="item-icon" src={ddragon.itemIcon(id, version)} width={20} height={20} alt="" />
                            ) : null)}
                          </div>
                          <div className="match-detail-score">
                            {p.aiScore != null ? p.aiScore.toFixed(0) : '—'}
                            {p.aiScoreLetter && <span className="text-tertiary" style={{ marginLeft: 4 }}>{p.aiScoreLetter}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
