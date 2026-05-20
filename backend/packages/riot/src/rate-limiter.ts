// Riot rate-limit handling.
//
// Two-layer Bottleneck:
//   Layer 1 — App rate limit:   reservoir 100 / 2 sec  AND  20000 / 10 min
//             (Production key default; dev key is much smaller.)
//   Layer 2 — Method rate limit: per-endpoint, parsed from headers.
//
// Rate-limit headers tell us actual usage so we self-throttle if we get above
// 80% of any limit. 429 → respect Retry-After + exponential backoff.
//
// Production key defaults (Riot policy, may change):
//   App:    100 req / 2s, 20000 req / 10min
//   Method: varies, /matches/by-puuid is 1500 / 10s in our region usually.
//
// Dev/personal/prod keys (Riot's actual published policy):
//   Dev:      20 / 1s, 100 / 2min      → sustained ~0.83 req/s. Expires 24h.
//   Personal: 20 / 1s, 100 / 2min      → identical rate limits to dev; the
//                                        win is a 1-year expiry, not speed.
//   Prod:    500 / 10s, 30000 / 10min  → sustained ~50 req/s. Negotiated.

import Bottleneck from 'bottleneck';

export type KeyTier = 'dev' | 'personal' | 'prod';

interface AppLimit { perSecond: number; longWindow: number; longSeconds: number; }
const APP_LIMITS: Record<KeyTier, AppLimit> = {
  dev:      { perSecond: 20,  longWindow: 100,   longSeconds: 120 },   // 100 / 2 min
  personal: { perSecond: 20,  longWindow: 100,   longSeconds: 120 },   // same as dev
  prod:     { perSecond: 50,  longWindow: 30000, longSeconds: 600 },   // 30k / 10 min
};

export interface RateLimitOptions {
  keyTier?: KeyTier;
  /** Throttle harder when usage exceeds this fraction of limit. Default 0.8. */
  warningThreshold?: number;
}

export interface RateLimitState {
  appUsedShort: number;
  appLimitShort: number;
  appUsedLong: number;
  appLimitLong: number;
  lastRetryAfterMs: number;
}

export class RateLimiter {
  private appLimiter: Bottleneck;
  private methodLimiters = new Map<string, Bottleneck>();
  private state: RateLimitState = {
    appUsedShort: 0, appLimitShort: 0,
    appUsedLong: 0, appLimitLong: 0,
    lastRetryAfterMs: 0,
  };
  private warningThreshold: number;
  private throttleFactor = 1.0; // multiplier on minTime; bumps when usage high
  private baseMinTime: number;

  constructor(opts: RateLimitOptions = {}) {
    const tier = opts.keyTier ?? 'prod';
    const limits = APP_LIMITS[tier];
    this.warningThreshold = opts.warningThreshold ?? 0.8;

    // Two-window enforcement:
    //   - per-second cap (short burst limit)
    //   - long-window reservoir (100/2min for dev, 1500/2min for personal,
    //     20000/10min for prod). The long window is usually the binding
    //     constraint for sustained throughput.
    const sustainedPerSec = limits.longWindow / limits.longSeconds;
    this.baseMinTime = Math.max(
      Math.ceil(1000 / limits.perSecond) * 1.1,
      Math.ceil(1000 / sustainedPerSec),
    );

    this.appLimiter = new Bottleneck({
      reservoir: limits.longWindow,
      reservoirRefreshAmount: limits.longWindow,
      reservoirRefreshInterval: limits.longSeconds * 1000,
      minTime: this.baseMinTime,
      maxConcurrent: Math.min(limits.perSecond, 8),
    });
  }

  /** Schedule an outgoing request through the app + method limiters.
   *
   * expiration: drops queued tasks that haven't started within the window.
   * Without this, BullMQ retries pile up tasks faster than reservoir drains,
   * the queue grows unbounded, and every schedule() eventually never returns
   * (caught only by the outer job-handler timeout) — death spiral.
   */
  async schedule<T>(methodKey: string, fn: () => Promise<T>): Promise<T> {
    const methodLim = this.getMethodLimiter(methodKey);
    return this.appLimiter.schedule(
      { expiration: 30_000 },
      () => methodLim.schedule({ expiration: 30_000 }, fn),
    );
  }

  /** Update internal counters from response headers. */
  updateFromHeaders(h: Headers, methodKey: string) {
    const appCount = parseLimitHeader(h.get('X-App-Rate-Limit-Count'));
    const appLimit = parseLimitHeader(h.get('X-App-Rate-Limit'));
    const methodCount = parseLimitHeader(h.get('X-Method-Rate-Limit-Count'));
    const methodLimit = parseLimitHeader(h.get('X-Method-Rate-Limit'));

    if (appCount.length > 0 && appLimit.length > 0) {
      this.state.appUsedShort = appCount[0]?.[0] ?? 0;
      this.state.appLimitShort = appLimit[0]?.[0] ?? 0;
      this.state.appUsedLong = appCount[1]?.[0] ?? 0;
      this.state.appLimitLong = appLimit[1]?.[0] ?? 0;
    }

    // Static rate limit: rely on Bottleneck's reservoir + minTime instead of
    // dynamically bumping minTime, which can slow throughput to a crawl
    // (factor 4 → minTime 4.8s) and never recover if low usage doesn't
    // register due to backed-up queue.
    this.adjustMethodLimiter(methodKey, methodLimit, methodCount);
  }

  /** Apply 429 backoff. Returns delay (ms) before retry. */
  noteRateLimited(retryAfterSeconds: number): number {
    const ms = Math.max(1000, Math.ceil(retryAfterSeconds * 1000));
    this.state.lastRetryAfterMs = ms;
    this.bumpThrottle();
    return ms;
  }

  getState(): Readonly<RateLimitState> { return this.state; }

  // --- internals --------------------------------------------------------
  private getMethodLimiter(key: string): Bottleneck {
    let l = this.methodLimiters.get(key);
    if (!l) {
      l = new Bottleneck({ maxConcurrent: 8, minTime: 50 });
      this.methodLimiters.set(key, l);
    }
    return l;
  }

  private adjustMethodLimiter(
    key: string,
    limits: Array<[number, number]>,
    counts: Array<[number, number]>,
  ) {
    if (!limits.length || !counts.length) return;
    const lim = this.getMethodLimiter(key);
    // If method limit is being approached, slow this method down.
    const usage = limits.map((entry, i) => {
      const c = counts[i]?.[0] ?? 0;
      return entry[0] > 0 ? c / entry[0] : 0;
    });
    const max = Math.max(...usage);
    if (max > 0.9) lim.updateSettings({ minTime: 200 });
    else if (max > 0.7) lim.updateSettings({ minTime: 100 });
    else lim.updateSettings({ minTime: 50 });
  }

  private bumpThrottle() {
    this.throttleFactor = Math.min(4.0, this.throttleFactor * 1.5);
    this.appLimiter.updateSettings({
      minTime: Math.ceil(this.baseMinTime * this.throttleFactor),
    });
  }
  private relaxThrottle() {
    this.throttleFactor = Math.max(1.0, this.throttleFactor / 1.5);
    this.appLimiter.updateSettings({
      minTime: Math.ceil(this.baseMinTime * this.throttleFactor),
    });
  }
}

// Header format: "1:1,5:120" → [[1,1],[5,120]] meaning 1 used in 1s window, 5 in 120s window.
function parseLimitHeader(v: string | null): Array<[number, number]> {
  if (!v) return [];
  return v.split(',').map((seg) => {
    const [n, w] = seg.split(':').map((s) => parseInt(s.trim(), 10));
    return [Number.isFinite(n) ? n : 0, Number.isFinite(w) ? w : 0] as [number, number];
  });
}
