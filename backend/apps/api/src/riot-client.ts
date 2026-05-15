// Shared Riot client for the API process.
// Same shape as the worker's; we initialize separately so each process
// owns its own rate limiter (worker's bucket is for bulk; API's is for
// user-triggered look-ups).

import { RiotClient } from '@lol-tracker/riot';

const apiKey = process.env.RIOT_API_KEY;
if (!apiKey) throw new Error('RIOT_API_KEY not set');

export const riot = new RiotClient({
  apiKey,
  keyTier: (process.env.RIOT_KEY_TIER ?? 'prod') as 'dev' | 'personal' | 'prod',
});
