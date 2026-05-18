// Patch notes proxy — scrapes leagueoflegends.com/ko-kr/news/tags/patch-notes/
// and individual article pages. Riot has no official patch-notes API, but the
// site is Next.js and embeds the full article payload in __NEXT_DATA__, so
// we extract the JSON instead of parsing HTML.
//
// Caching: 24h Redis. Patch notes don't change after release; refresh window
// only matters around a new patch (12-hour double-check window is fine).

import type { FastifyInstance } from 'fastify';
import { redis } from '../redis.js';

const LIST_URL  = 'https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/';
const ARTICLE_BASE = 'https://www.leagueoflegends.com';
const UA = 'Mozilla/5.0 (compatible; TeamLOLBot/1.0; +https://teamlol.kr)';
const LIST_TTL_SEC   = 6 * 60 * 60;  // 6h — catches new patch within 6h of release
const DETAIL_TTL_SEC = 24 * 60 * 60; // 24h — body is immutable post-release
const FETCH_TIMEOUT_MS = 15_000;

interface PatchSummary {
  title: string;
  slug: string;           // last path segment used for our /patches/:slug
  url: string;            // absolute Riot URL (for "원문" link)
  publishedAt: string;
  description: string;
  thumbnail: string | null;
  category: string | null;
}

interface PatchDetail {
  title: string;
  slug: string;
  url: string;
  publishedAt: string;
  banner: string | null;
  description: string;
  html: string;           // sanitized rich-text body
}

// --- helpers --------------------------------------------------------------

async function fetchPage(url: string): Promise<string> {
  const ctl = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR' }, signal: ctl });
  if (!res.ok) throw new Error(`riot site ${res.status} on ${url}`);
  return await res.text();
}

function extractNextData(html: string): any {
  // The blob is between `>` and the closing `</script>`; we capture lazily.
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m || !m[1]) throw new Error('__NEXT_DATA__ not found');
  return JSON.parse(m[1]);
}

function slugFromAction(payload: { url?: string } | undefined): string | null {
  if (!payload?.url) return null;
  const path = payload.url.replace(/\/+$/, '');  // trim trailing slash
  const parts = path.split('/');
  return parts[parts.length - 1] || null;
}

// Strip executable HTML (script/style/on* handlers) without pulling in a full
// sanitizer. Riot's body is mostly headings/lists/imgs/anchors — safe enough.
function sanitizeHtml(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/\son[a-z]+="[^"]*"/gi, '')
    .replace(/\son[a-z]+='[^']*'/gi, '')
    // Drop noscript wrappers but keep their inner content readable
    .replace(/<\/?noscript[^>]*>/gi, '');
}

function pickFirstString(o: unknown): string {
  if (typeof o === 'string') return o;
  if (o && typeof o === 'object') {
    const obj = o as Record<string, unknown>;
    if (typeof obj.body === 'string') return obj.body;
    if (typeof obj.text === 'string') return obj.text;
  }
  return '';
}

// --- routes ---------------------------------------------------------------

export default async function patchNotesRoutes(app: FastifyInstance) {

  // List — last N patch articles (most recent first)
  app.get<{ Querystring: { limit?: string } }>('/api/patch-notes', async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 20) || 20, 50);
    const cacheKey = `patch-notes:list:${limit}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const html = await fetchPage(LIST_URL);
    const data = extractNextData(html);
    const blades = data?.props?.pageProps?.page?.blades ?? [];
    // Find the blade that carries the article list (key: items as array of articles)
    const listBlade = blades.find((b: any) => Array.isArray(b?.items) && b.items[0]?.publishedAt);
    const items: any[] = listBlade?.items ?? [];

    const entries: PatchSummary[] = items.slice(0, limit).map((it) => {
      const slug = slugFromAction(it.action?.payload) ?? '';
      const url  = it.action?.payload?.url ? `${ARTICLE_BASE}${it.action.payload.url}` : LIST_URL;
      return {
        title:       String(it.title ?? ''),
        slug,
        url,
        publishedAt: String(it.publishedAt ?? ''),
        description: pickFirstString(it.description),
        thumbnail:   typeof it.media?.url === 'string' ? it.media.url
                  : typeof it.imageMedia?.url === 'string' ? it.imageMedia.url : null,
        category:    typeof it.category?.title === 'string' ? it.category.title : null,
      };
    }).filter((e: PatchSummary) => e.slug);

    const out = { fetchedAt: new Date().toISOString(), count: entries.length, entries };
    await redis.set(cacheKey, JSON.stringify(out), 'EX', LIST_TTL_SEC);
    return out;
  });

  // Detail — single patch by its Riot URL slug
  app.get<{ Params: { slug: string } }>('/api/patch-notes/:slug', async (req, reply) => {
    const slug = req.params.slug;
    if (!/^[a-z0-9-]+$/i.test(slug) || slug.length > 200) {
      return reply.status(400).send({ error: 'bad slug' });
    }
    const cacheKey = `patch-notes:detail:${slug}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const articleUrl = `${ARTICLE_BASE}/ko-kr/news/game-updates/${slug}`;
    let html: string;
    try {
      html = await fetchPage(articleUrl);
    } catch (e) {
      return reply.status(502).send({ error: 'upstream fetch failed', detail: String(e) });
    }
    const data = extractNextData(html);
    const page = data?.props?.pageProps?.page;
    if (!page || page.type !== 'patchNote') {
      return reply.status(404).send({ error: 'not a patch note page' });
    }
    const blades: any[] = page.blades ?? [];
    const masthead = blades.find((b) => b.type === 'articleMasthead') ?? {};
    const richTextBlade = blades.find((b) => b.type === 'patchNotesRichText') ?? {};
    const bannerUrl = masthead?.banner?.url ?? masthead?.banner?.image?.url ?? null;
    const bodyHtml = pickFirstString(richTextBlade.richText);

    const out: PatchDetail = {
      title:       String(masthead.title ?? page.title ?? ''),
      slug,
      url:         articleUrl,
      publishedAt: String(masthead.publishDate ?? page.displayedPublishDate ?? ''),
      banner:      typeof bannerUrl === 'string' ? bannerUrl : null,
      description: pickFirstString(masthead.description ?? page.description),
      html:        sanitizeHtml(bodyHtml),
    };
    if (!out.html) return reply.status(404).send({ error: 'empty body' });

    await redis.set(cacheKey, JSON.stringify(out), 'EX', DETAIL_TTL_SEC);
    return out;
  });
}
