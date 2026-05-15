// Single shared Riot client instance for all workers in this process.
import { RiotClient } from '@lol-tracker/riot';
import { env } from './env.js';

export const riot = new RiotClient({
  apiKey: env.RIOT_API_KEY,
  keyTier: env.RIOT_KEY_TIER,
});
