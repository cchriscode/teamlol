import Link from 'next/link';
import { ddragon } from '@/lib/ddragon';
import type { SummonerSearchResponse } from '@/lib/api-types-summoner';
import { getDdragonVersion } from '@/lib/ddragon-version';
import { tierKr, tierClass, timeAgo } from '@/lib/display';
import { RefreshButton } from './refresh-button';

type Tab = 'overview' | 'champions' | 'live' | 'seasons';

interface Props {
  summoner: SummonerSearchResponse;
  region: string;
  riotId: string;
  tab: Tab;
  /** Pass the ddragon version if the parent already resolved it — skips a redundant lookup. */
  version?: string;
}

export async function SummonerHeader({ summoner, region, riotId, tab, version: versionProp }: Props) {
  const version = versionProp ?? await getDdragonVersion();
  const profileIconUrl = summoner.summoner ? ddragon.profileIcon(summoner.summoner.profileIconId, version) : null;
  const solo = summoner.leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  const flex = summoner.leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR');

  return (
    <>
      <div className="card profile-header">
        <div className="profile-top">
          <div className="profile-icon-wrap">
            {profileIconUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="profile-icon-img" src={profileIconUrl} width={80} height={80} alt="" />
            )}
            <div className="profile-level">{summoner.summoner?.summonerLevel ?? '—'}</div>
          </div>
          <div className="profile-info">
            <div className="profile-name">
              {summoner.account.gameName}<span className="tag"> #{summoner.account.tagLine}</span>
            </div>
            <div className="profile-meta">
              마지막 갱신: {summoner.summoner ? timeAgo(new Date(summoner.summoner.refreshedAt).getTime()) : '—'}
              · 매치 {summoner.matchesAvailable}개 수집됨
            </div>
            <div className="profile-actions">
              <RefreshButton puuid={summoner.account.puuid} />
            </div>
          </div>
        </div>

        <div className="rank-cards">
          {[
            { label: '솔로랭크', entry: solo },
            { label: '자유랭크', entry: flex },
          ].map(({ label, entry }) => (
            <div key={label} className="rank-card">
              <div>
                <div className="rank-card-label">{label}</div>
                {entry ? (
                  <>
                    <div className={`rank-tier ${tierClass(entry.tier)}`}>{tierKr(entry.tier)} {entry.rank}</div>
                    <div className="rank-lp">{entry.leaguePoints.toLocaleString('ko-KR')} LP</div>
                  </>
                ) : (
                  <>
                    <div className="rank-tier text-tertiary">Unranked</div>
                    <div className="rank-lp">—</div>
                  </>
                )}
              </div>
              {entry && (
                <div className="rank-record">
                  <div className="wl">{entry.wins}승 {entry.losses}패</div>
                  <div className="winrate">{entry.winrate}%</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <nav className="tabs" aria-label="소환사 페이지 탭">
        <Link className={`tab${tab === 'overview' ? ' active' : ''}`}  href={`/${region}/${riotId}`}>개요</Link>
        <Link className={`tab${tab === 'champions' ? ' active' : ''}`} href={`/${region}/${riotId}/champions`}>챔피언 통계</Link>
        <Link className={`tab${tab === 'live' ? ' active' : ''}`}      href={`/${region}/${riotId}/live`}>라이브 게임</Link>
        <Link className={`tab${tab === 'seasons' ? ' active' : ''}`}   href={`/${region}/${riotId}/seasons`}>시즌 기록</Link>
      </nav>
    </>
  );
}
