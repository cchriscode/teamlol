// Fastify API server.
// Single process; routes split by file under src/routes/.

import { env } from './env.js';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import { redis } from './redis.js';
import healthRoutes from './routes/health.js';
import championsRoutes from './routes/champions.js';
import championDetailRoutes from './routes/champion-detail.js';
import summonerRoutes from './routes/summoner.js';
import pickRecommendRoutes from './routes/pick-recommend.js';
import matchRoutes from './routes/match.js';
import spectatorRoutes from './routes/spectator.js';
import leaderboardRoutes from './routes/leaderboard.js';
import homeRoutes from './routes/home.js';
import summonerChampionStatsRoutes from './routes/summoner-champion-stats.js';
import summonerSeasonsRoutes from './routes/summoner-seasons.js';
import masteryRoutes from './routes/mastery.js';
import matchTimelineRoutes from './routes/match-timeline.js';

async function main() {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: process.env.NODE_ENV === 'production' ? undefined : {
        target: 'pino-pretty',
        options: { colorize: true, ignore: 'pid,hostname' },
      },
    },
  });

  // CORS — explicit allowlist. Defaults to localhost dev origins; production
  // must set API_CORS_ORIGINS to a comma-separated list. '*' is allowed but
  // discouraged (logged at boot via env.ts).
  await app.register(cors, {
    origin: env.CORS_ORIGINS.includes('*') ? true : env.CORS_ORIGINS,
    methods: ['GET', 'POST'],
    credentials: false,
  });

  // gzip / brotli for responses larger than 1KB. Saves ~70% bytes on the
  // pick-recommend payload (~200KB JSON).
  await app.register(compress, {
    encodings: ['br', 'gzip'],
    threshold: 1024,
  });

  // Global rate limit — 120 req/min per IP across all routes. Per-route
  // tighter limits (e.g. /refresh) are applied inline using the same plugin's
  // {config: {rateLimit: ...}} hook.
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    redis,
    nameSpace: 'rl-global:',
    keyGenerator: (req) => {
      const xff = req.headers['x-forwarded-for'];
      const fwd = Array.isArray(xff) ? xff[0] : (xff?.split(',')[0]?.trim());
      return fwd || req.ip;
    },
  });

  await app.register(healthRoutes);
  await app.register(championsRoutes);
  await app.register(championDetailRoutes);
  await app.register(summonerRoutes);
  await app.register(pickRecommendRoutes);
  await app.register(matchRoutes);
  await app.register(spectatorRoutes);
  await app.register(leaderboardRoutes);
  await app.register(homeRoutes);
  await app.register(summonerChampionStatsRoutes);
  await app.register(summonerSeasonsRoutes);
  await app.register(masteryRoutes);
  await app.register(matchTimelineRoutes);

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'not found', path: req.url });
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    req.log.error({ err: err.message, stack: err.stack }, 'request failed');
    // 4xx → use whatever the route raised (already sanitized).
    // 5xx in production → generic message; details live in server logs only.
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500
      ? err.statusCode : 500;
    if (status >= 500 && process.env.NODE_ENV === 'production') {
      reply.status(status).send({ error: 'internal server error' });
    } else {
      reply.status(status).send({ error: err.message });
    }
  });

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info({ port: env.PORT, host: env.HOST, corsOrigins: env.CORS_ORIGINS }, 'API ready');

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutdown');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('API boot failed:', err);
  process.exit(1);
});
