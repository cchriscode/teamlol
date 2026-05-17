import Link from 'next/link';
import { HeroSearch } from './hero-search';
import { apiGet } from '@/lib/api';
import { ChampionIcon } from '@/components/atoms/champion-icon';
import { getChampionMeta } from '@/lib/champion-meta';
import { slugFromRiotId } from '@/lib/riot-id';

export const revalidate = 300;

interface PopularEntry { riot_id: string; n: number; puuid: string; region: string; }
interface PopularResp { windowHours: number; generatedAt: string; entries: PopularEntry[]; }

interface TrendingEntry {
  championId: number; lane: string; wr: number; pickrate: number;
  banrate: number; n: number; wrDelta: number;
}
interface TrendingResp { generatedAt: string; bracket: string; entries: TrendingEntry[]; }

function laneKr(l: string) {
  return ({ top: '탑', jungle: '정글', mid: '미드', adc: '원딜', support: '서폿' } as Record<string, string>)[l] ?? l;
}

function parseRiotId(s: string) {
  const idx = s.indexOf('#');
  if (idx < 1) return { gameName: s, tagLine: '' };
  return { gameName: s.slice(0, idx), tagLine: s.slice(idx + 1) };
}

export default async function HomePage() {
  const [popular, trending, meta] = await Promise.all([
    apiGet<PopularResp>('/api/home/popular-searches').catch(() => ({ windowHours: 1, generatedAt: '', entries: [] as PopularEntry[] })),
    apiGet<TrendingResp>('/api/home/trending-champions').catch(() => ({ generatedAt: '', bracket: 'diamond+', entries: [] as TrendingEntry[] })),
    getChampionMeta(),
  ]);

  return (
    <>
      <section className="hero">
        <div className="hero-meta">PATCH 16.10 · KR</div>
        <h1 className="hero-title">소환사명을 검색하세요</h1>
        <HeroSearch />
        <div className="hero-hint">예시: Hide on bush#KR1 · Chovy#KR1</div>
      </section>

      <div className="home-grid">
        <div className="card">
          <div className="section-title">
            <span>실시간 인기 검색</span>
            <span className="meta">최근 {popular.windowHours}시간</span>
          </div>
          <div>
            {popular.entries.length === 0 ? (
              <div className="text-tertiary" style={{ padding: 16 }}>검색 기록 없음</div>
            ) : (
              popular.entries.slice(0, 10).map((e, i) => {
                const id = parseRiotId(e.riot_id);
                const safeName = /[\uD800-\uDFFF]/.test(id.gameName) ? `#${e.puuid.slice(0, 6)}` : id.gameName;
                return (
                  <Link
                    key={e.puuid}
                    className="ranking-item"
                    href={`/${e.region}/${slugFromRiotId(id)}`}
                  >
                    <div>
                      <span className={`rank-num${i < 3 ? ' top' : ''}`}>{i + 1}</span>
                      <span className="fw-medium">{safeName}</span>
                      {id.tagLine && <span className="text-tertiary"> #{id.tagLine}</span>}
                    </div>
                    <span className="text-tertiary">{e.n.toLocaleString('ko-KR')}</span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <div className="section-title">
            <span>이번 패치 떡상 챔프</span>
            <span className="meta">{trending.bracket}</span>
          </div>
          <div>
            {trending.entries.length === 0 ? (
              <div className="text-tertiary" style={{ padding: 16 }}>데이터 부족</div>
            ) : (
              trending.entries.slice(0, 8).map((e) => {
                const champ = meta.byId.get(e.championId);
                if (!champ) return null;
                return (
                  <Link
                    key={`${e.championId}-${e.lane}`}
                    className="meta-champ"
                    href={`/champions/${encodeURIComponent(champ.id)}?lane=${e.lane}&bracket=${encodeURIComponent(trending.bracket)}`}
                  >
                    <div className="meta-champ-info">
                      <ChampionIcon championKey={champ.id} size={36} alt={champ.name} />
                      <div>
                        <div className="fw-medium">{champ.name}</div>
                        <div className="text-tertiary" style={{ fontSize: 11 }}>{laneKr(e.lane)}</div>
                      </div>
                    </div>
                    <div className="meta-champ-stats">
                      <div className="winrate">{e.wr.toFixed(2)}%</div>
                      <div className="delta">{e.wrDelta > 0 ? '+' : ''}{e.wrDelta.toFixed(1)}%p</div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </div>
      </div>
    </>
  );
}
