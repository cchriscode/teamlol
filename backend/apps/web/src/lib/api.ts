// Typed fetch wrapper for the Fastify backend at NEXT_PUBLIC_API_BASE_URL.
// Server components: pass `next: { revalidate: N }` for ISR; client: omit.

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

export interface FetchOpts {
  signal?: AbortSignal;
  // Pass through to fetch.next for ISR / cache control on server side.
  next?: { revalidate?: number; tags?: string[] };
  cache?: RequestCache;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public url: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiGet<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    signal: opts.signal,
    next: opts.next,
    cache: opts.cache,
  });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new ApiError(res.status, body || res.statusText, url);
  }
  return (await res.json()) as T;
}
