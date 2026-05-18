'use client';

import { useState } from 'react';
import { ddragon } from '@/lib/ddragon';
import { slugFromRiotId } from '@/lib/riot-id';
import Link from 'next/link';

interface CoPlayer {
  puuid: string;
  gameName: string | null;
  tagLine: string | null;
  profileIconId: number | null;
  tier: string | null;
  rank: string | null;
  sameTeam: { games: number; wins: number };
  oppTeam:  { games: number; wins: number };
}

interface Props {
  sameTeam: CoPlayer[];
  oppTeam: CoPlayer[];
  region: string;
  version: string;
  sampleMatches: number;
}

const TIER_SHORT: Record<string, string> = {
  IRON: 'I', BRONZE: 'B', SILVER: 'S', GOLD: 'G', PLATINUM: 'P',
  EMERALD: 'E', DIAMOND: 'D', MASTER: 'M', GRANDMASTER: 'GM', CHALLENGER: 'CH',
};

export function CoPlayersCard({ sameTeam, oppTeam, region, version, sampleMatches }: Props) {
  const [tab, setTab] = useState<'same' | 'opp'>('same');
  const list = tab === 'same' ? sameTeam : oppTeam;

  return (
    <div className="card">
      <div className="section-title">
        함께 플레이한 소환사
        <span className="meta">최근 {sampleMatches}게임</span>
      </div>
      <div className="filter-row" style={{ marginBottom: 8 }}>
        <button type="button" className={`filter-chip${tab === 'same' ? ' active' : ''}`} onClick={() => setTab('same')}>
          우리 팀
        </button>
        <button type="button" className={`filter-chip${tab === 'opp' ? ' active' : ''}`} onClick={() => setTab('opp')}>
          상대 팀
        </button>
      </div>
      {list.length === 0 ? (
        <div className="text-tertiary" style={{ padding: 8, fontSize: 12 }}>데이터 없음</div>
      ) : (
        <div>
          {list.map((p) => {
            const bucket = tab === 'same' ? p.sameTeam : p.oppTeam;
            const wr = bucket.games > 0 ? (bucket.wins / bucket.games) * 100 : 0;
            const tierShort = p.tier ? (TIER_SHORT[p.tier] ?? p.tier) : null;
            const linkable = p.gameName && p.tagLine;
            const inner = (
              <div className="co-player-row">
                {p.profileIconId != null ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="profile-icon-img" src={ddragon.profileIcon(p.profileIconId, version)} width={28} height={28} alt="" />
                ) : (
                  <div className="profile-icon-img" style={{ width: 28, height: 28, background: 'var(--bg-elevated)' }} />
                )}
                <div className="co-player-info">
                  <div className="co-player-name">{p.gameName ?? `#${p.puuid.slice(0, 6)}`}</div>
                  <div className="co-player-meta">
                    {bucket.games}게임
                    {tab === 'same' && <> · {wr.toFixed(0)}%</>}
                    {tierShort && <span className={`tier-badge tier-${(p.tier ?? '').toLowerCase()}`} style={{ marginLeft: 4 }}>{tierShort}</span>}
                  </div>
                </div>
              </div>
            );
            if (linkable) {
              return (
                <Link key={p.puuid} href={`/${region}/${slugFromRiotId({ gameName: p.gameName!, tagLine: p.tagLine! })}`}
                      style={{ textDecoration: 'none', color: 'inherit' }}>
                  {inner}
                </Link>
              );
            }
            return <div key={p.puuid}>{inner}</div>;
          })}
        </div>
      )}
    </div>
  );
}
