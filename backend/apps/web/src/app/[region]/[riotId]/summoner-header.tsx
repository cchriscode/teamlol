import Link from 'next/link';
import { ddragon } from '@/lib/ddragon';
import type { SummonerSearchResponse } from '@/lib/api-types-summoner';
import { getDdragonVersion } from '@/lib/ddragon-version';

type Tab = 'overview' | 'champions' | 'live' | 'seasons';

function tierKr(tier: string) {
  const map: Record<string, string> = {
    IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
    PLATINUM: 'Platinum', EMERALD: 'Emerald', DIAMOND: 'Diamond',
    MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
  };
  return map[tier] ?? tier;
}
function tierClass(tier: string) { return 'tier-' + tier.toLowerCase(); }
function timeAgo(ms: number): string {
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}초 전`;
  const m = Math.floor(sec / 60); if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

interface Props {
  summoner: SummonerSearchResponse;
  region: string;
  riotId: string;
  tab: Tab;
}

export async function SummonerHeader({ summoner, region, riotId, tab }: Props) {
  const version = await getDdragonVersion();
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
              <button className="primary" type="button">전적 갱신</button>
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
