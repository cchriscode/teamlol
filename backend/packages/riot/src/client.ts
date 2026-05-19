// Riot Games API client.
// Thin, typed wrapper over fetch with rate limiting, retry, and routing.
//
// Usage:
//   const riot = new RiotClient({ apiKey: process.env.RIOT_API_KEY!, keyTier: 'prod' });
//   const acct = await riot.account.byRiotId('asia', 'Hide on bush', 'KR1');
//   const matches = await riot.match.idsByPuuid('asia', acct.puuid, { count: 20 });

import { Region, RegionalRoute, Puuid, QueueType, RankedTier, Division } from '@lol-tracker/shared';
import { RateLimiter, KeyTier } from './rate-limiter.js';
import { platformBase, regionalBase } from './routing.js';
import {
  RiotAccountDto, SummonerDto, LeagueEntryDto, LeagueListDto,
  MatchDto, MatchTimelineDto, CurrentGameInfoDto, ChampionMasteryDto, PlatformDataDto,
} from './types.js';

export interface RiotClientOptions {
  apiKey: string;
  keyTier?: KeyTier;
  baseFetch?: typeof fetch;
  /** ms to wait before giving up after retries. Default 60_000. */
  retryBudgetMs?: number;
  /** Per-request timeout in ms. Hard ceiling — prevents stuck fetches from hanging the worker. Default 30_000. */
  requestTimeoutMs?: number;
}

export class RiotApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly url: string,
    public readonly methodKey: string,
  ) {
    super(`Riot API ${status} on ${methodKey} (${url})`);
    this.name = 'RiotApiError';
  }
}

export class RiotClient {
  private apiKey: string;
  private rl: RateLimiter;
  private fetchFn: typeof fetch;
  private retryBudgetMs: number;
  private requestTimeoutMs: number;

  // Endpoint groups exposed for ergonomic call-site (riot.match.byId(...))
  readonly account: AccountEndpoints;
  readonly summoner: SummonerEndpoints;
  readonly league: LeagueEndpoints;
  readonly match: MatchEndpoints;
  readonly spectator: SpectatorEndpoints;
  readonly mastery: MasteryEndpoints;
  readonly status: StatusEndpoints;

  constructor(opts: RiotClientOptions) {
    if (!opts.apiKey) throw new Error('RiotClient requires apiKey');
    this.apiKey = opts.apiKey;
    this.rl = new RateLimiter({ keyTier: opts.keyTier ?? 'prod' });
    this.fetchFn = opts.baseFetch ?? fetch;
    this.retryBudgetMs = opts.retryBudgetMs ?? 60_000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;

    this.account = new AccountEndpoints(this);
    this.summoner = new SummonerEndpoints(this);
    this.league = new LeagueEndpoints(this);
    this.match = new MatchEndpoints(this);
    this.spectator = new SpectatorEndpoints(this);
    this.mastery = new MasteryEndpoints(this);
    this.status = new StatusEndpoints(this);
  }

  /** Internal: perform a GET with rate limiting and retry.
   *
   * `parentSignal` lets the caller (job handler) cancel work even while it's
   * waiting in the Bottleneck reservoir queue. Without this, an exhausted
   * reservoir means schedule() never returns and the only rescue is the outer
   * job-level setTimeout — by which point the task is still queued and will
   * eventually consume a reservoir slot for nothing.
   */
  async get<T>(url: string, methodKey: string, parentSignal?: AbortSignal): Promise<T> {
    return this.rl.schedule(methodKey, async () => {
      // Bail before consuming a reservoir slot if caller already gave up.
      if (parentSignal?.aborted) throw new RiotApiError(0, 'aborted before fetch', url, methodKey);
      return this.executeOnce<T>(url, methodKey, 0, parentSignal);
    });
  }

  private async executeOnce<T>(url: string, methodKey: string, _attempt: number, parentSignal?: AbortSignal): Promise<T> {
    // Combine our request timeout with the caller's job-level abort.
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    if (parentSignal) {
      if (parentSignal.aborted) ctrl.abort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }
    const timer = setTimeout(() => ctrl.abort(), this.requestTimeoutMs);
    try {
      let res: Response;
      try {
        res = await this.fetchFn(url, {
          method: 'GET',
          headers: { 'X-Riot-Token': this.apiKey, Accept: 'application/json' },
          signal: ctrl.signal,
        });
      } catch (err) {
        const aborted = (err as { name?: string })?.name === 'AbortError';
        throw new RiotApiError(aborted ? 0 : -1, aborted ? 'request timeout' : String(err), url, methodKey);
      }

      this.rl.updateFromHeaders(res.headers, methodKey);

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('Retry-After')) || 1;
        const limitType = res.headers.get('X-Rate-Limit-Type') ?? 'unknown';
        const appCount = res.headers.get('X-App-Rate-Limit-Count') ?? '';
        const methodCount = res.headers.get('X-Method-Rate-Limit-Count') ?? '';
        this.rl.noteRateLimited(retryAfter);
        // Surface 429 context (limit bucket, current usage, wait) so production
        // review can see the bucket we tripped wasn't from runaway code.
        // eslint-disable-next-line no-console
        console.warn(
          `[riot 429] ${methodKey} retryAfter=${retryAfter}s type=${limitType} ` +
          `app=${appCount} method=${methodCount}`,
        );
        throw new RiotApiError(429, await res.text(), url, methodKey);
      }

      if (res.status === 404) {
        throw new RiotApiError(404, null, url, methodKey);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new RiotApiError(res.status, body, url, methodKey);
      }

      return await (res.json() as Promise<T>);
    } finally {
      clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
    }
  }

  getRateState() { return this.rl.getState(); }
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
function enc(s: string) { return encodeURIComponent(s); }

// ====================================================================
// Endpoint groups
// ====================================================================

class AccountEndpoints {
  constructor(private c: RiotClient) {}
  byRiotId(regional: RegionalRoute, gameName: string, tagLine: string): Promise<RiotAccountDto> {
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${enc(gameName)}/${enc(tagLine)}`;
    return this.c.get<RiotAccountDto>(url, 'account.byRiotId');
  }
  byPuuid(regional: RegionalRoute, puuid: Puuid): Promise<RiotAccountDto> {
    const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${enc(puuid)}`;
    return this.c.get<RiotAccountDto>(url, 'account.byPuuid');
  }
}

class SummonerEndpoints {
  constructor(private c: RiotClient) {}
  byPuuid(region: Region, puuid: Puuid): Promise<SummonerDto> {
    const url = `${platformBase(region)}/lol/summoner/v4/summoners/by-puuid/${enc(puuid)}`;
    return this.c.get<SummonerDto>(url, 'summoner.byPuuid');
  }
}

class LeagueEndpoints {
  constructor(private c: RiotClient) {}
  entriesByPuuid(region: Region, puuid: Puuid): Promise<LeagueEntryDto[]> {
    const url = `${platformBase(region)}/lol/league/v4/entries/by-puuid/${enc(puuid)}`;
    return this.c.get<LeagueEntryDto[]>(url, 'league.entriesByPuuid');
  }
  challenger(region: Region, queue: QueueType): Promise<LeagueListDto> {
    const url = `${platformBase(region)}/lol/league/v4/challengerleagues/by-queue/${enc(queue)}`;
    return this.c.get<LeagueListDto>(url, 'league.challenger');
  }
  grandmaster(region: Region, queue: QueueType): Promise<LeagueListDto> {
    const url = `${platformBase(region)}/lol/league/v4/grandmasterleagues/by-queue/${enc(queue)}`;
    return this.c.get<LeagueListDto>(url, 'league.grandmaster');
  }
  master(region: Region, queue: QueueType): Promise<LeagueListDto> {
    const url = `${platformBase(region)}/lol/league/v4/masterleagues/by-queue/${enc(queue)}`;
    return this.c.get<LeagueListDto>(url, 'league.master');
  }
  entriesByDivision(region: Region, queue: QueueType, tier: RankedTier, division: Division, page = 1) {
    const url = `${platformBase(region)}/lol/league/v4/entries/${enc(queue)}/${enc(tier)}/${enc(division)}?page=${page}`;
    return this.c.get<LeagueEntryDto[]>(url, 'league.entriesByDivision');
  }
}

export interface MatchIdsOpts {
  count?: number;            // 1..100, default 20
  start?: number;            // pagination offset
  startTime?: number;        // unix seconds
  endTime?: number;
  queue?: number;            // queue id
  type?: 'ranked' | 'normal' | 'tourney' | 'tutorial';
}

class MatchEndpoints {
  constructor(private c: RiotClient) {}
  idsByPuuid(regional: RegionalRoute, puuid: Puuid, opts: MatchIdsOpts = {}): Promise<string[]> {
    const params = new URLSearchParams();
    params.set('count', String(Math.min(100, Math.max(1, opts.count ?? 20))));
    if (opts.start != null) params.set('start', String(opts.start));
    if (opts.startTime != null) params.set('startTime', String(opts.startTime));
    if (opts.endTime != null) params.set('endTime', String(opts.endTime));
    if (opts.queue != null) params.set('queue', String(opts.queue));
    if (opts.type) params.set('type', opts.type);
    const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${enc(puuid)}/ids?${params.toString()}`;
    return this.c.get<string[]>(url, 'match.idsByPuuid');
  }
  byId(regional: RegionalRoute, matchId: string, signal?: AbortSignal): Promise<MatchDto> {
    const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/${enc(matchId)}`;
    return this.c.get<MatchDto>(url, 'match.byId', signal);
  }
  timelineById(regional: RegionalRoute, matchId: string, signal?: AbortSignal): Promise<MatchTimelineDto> {
    const url = `https://${regional}.api.riotgames.com/lol/match/v5/matches/${enc(matchId)}/timeline`;
    return this.c.get<MatchTimelineDto>(url, 'match.timelineById', signal);
  }
}

class SpectatorEndpoints {
  constructor(private c: RiotClient) {}
  activeBySummonerPuuid(region: Region, puuid: Puuid): Promise<CurrentGameInfoDto | null> {
    const url = `${platformBase(region)}/lol/spectator/v5/active-games/by-summoner/${enc(puuid)}`;
    return this.c.get<CurrentGameInfoDto>(url, 'spectator.active').catch((e) => {
      if (e instanceof RiotApiError && e.status === 404) return null;
      throw e;
    });
  }
}

class MasteryEndpoints {
  constructor(private c: RiotClient) {}
  byPuuid(region: Region, puuid: Puuid): Promise<ChampionMasteryDto[]> {
    const url = `${platformBase(region)}/lol/champion-mastery/v4/champion-masteries/by-puuid/${enc(puuid)}`;
    return this.c.get<ChampionMasteryDto[]>(url, 'mastery.byPuuid');
  }
  topByPuuid(region: Region, puuid: Puuid, count = 5): Promise<ChampionMasteryDto[]> {
    const url = `${platformBase(region)}/lol/champion-mastery/v4/champion-masteries/by-puuid/${enc(puuid)}/top?count=${count}`;
    return this.c.get<ChampionMasteryDto[]>(url, 'mastery.topByPuuid');
  }
}

class StatusEndpoints {
  constructor(private c: RiotClient) {}
  platformData(region: Region): Promise<PlatformDataDto> {
    const url = `${platformBase(region)}/lol/status/v4/platform-data`;
    return this.c.get<PlatformDataDto>(url, 'status.platformData');
  }
}
