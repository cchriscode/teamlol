'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChampionIcon } from '@/components/atoms/champion-icon';

interface SeasonChamp {
  championId: number;
  championKey: string;
  games: number;
  wins: number;
  avgKda: number;
}

interface Props {
  champs: SeasonChamp[];
  championNameByKey: Record<string, string>;
  region: string;
  riotId: string;
}

const TOP_N = 5;

export function SeasonChampList({ champs, championNameByKey, region, riotId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? champs : champs.slice(0, TOP_N);

  return (
    <div className="card">
      <div className="section-title">
        시즌 챔피언
        <span className="meta">{champs.length}개 챔프 · 전체</span>
      </div>
      {champs.length === 0 ? (
        <div className="text-tertiary" style={{ padding: 8, fontSize: 12 }}>수집된 매치가 없습니다</div>
      ) : (
        <>
          <div>
            {visible.map((c) => {
              const losses = c.games - c.wins;
              const wr = c.games > 0 ? (c.wins / c.games) * 100 : 0;
              const name = championNameByKey[c.championKey] ?? c.championKey;
              const wrCls = wr >= 60 ? 'text-positive' : wr <= 40 ? 'text-loss' : '';
              return (
                <div key={c.championId} className="season-champ-row">
                  <ChampionIcon championKey={c.championKey} size={32} alt={name} />
                  <div className="season-champ-info">
                    <div className="season-champ-name">{name}</div>
                    <div className="season-champ-meta text-tertiary">
                      KDA {c.avgKda.toFixed(2)}
                    </div>
                  </div>
                  <div className="season-champ-record">
                    <div className={`season-champ-wr ${wrCls}`}>{wr.toFixed(0)}%</div>
                    <div className="season-champ-wl text-tertiary">{c.wins}승 {losses}패</div>
                  </div>
                </div>
              );
            })}
          </div>
          {champs.length > TOP_N && !expanded && (
            <button type="button" className="season-champ-more"
                    onClick={() => setExpanded(true)}>
              더보기 ({champs.length - TOP_N}개)
            </button>
          )}
          {expanded && (
            <Link className="season-champ-more" href={`/${region}/${riotId}/champions`}>
              챔피언 통계 전체 보기 →
            </Link>
          )}
        </>
      )}
    </div>
  );
}
