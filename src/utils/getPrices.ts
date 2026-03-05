/**
 * getPrices — DefiLlama price fetcher
 *
 * Fetches current USD prices via the DefiLlama Coins API
 * (https://coins.llama.fi/prices/current/<id1>,<id2>,...).
 *
 * Each token id should be in DefiLlama's "<blockchain>:<address>" format —
 * which is exactly the `underlying` field on every ActiveAllocation, and the
 * `id` field on every Token in the registry.
 *
 * Returns a map of the same ids → USD price for every id DefiLlama recognised.
 * Ids that DefiLlama doesn't know about are silently absent from the result.
 */

import axios from "axios";

const PRICES_API = "https://coins.llama.fi/prices";
const CHUNK_SIZE = 50;
/** DefiLlama free tier: 10 req/min → 1 req per 6 s. We wait 6 s between chunks. */
const RATE_LIMIT_DELAY_MS = 6_000;

/** Maps "<blockchain>:<address>" → USD price */
export type PriceMap = Record<string, number>;

/**
 * @param tokenIds  Array of "<blockchain>:<address>" strings to price.
 *                  Duplicates are deduped automatically.
 */
export async function getPrices(tokenIds: string[]): Promise<PriceMap> {
  const uniqueIds = [...new Set(tokenIds)].filter(Boolean);

  if (uniqueIds.length === 0) return {};

  const result: PriceMap = {};

  for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    const chunk = uniqueIds.slice(i, i + CHUNK_SIZE);
    try {
      const { data } = await axios.get(
        `${PRICES_API}/current/${chunk.join(",")}`
      );
      for (const [key, value] of Object.entries(
        data.coins as Record<string, { price: number }>
      )) {
        result[key] = value.price;
      }
    } catch (err) {
      console.error(
        `getPrices: failed to fetch chunk [${chunk[0]} … ${chunk[chunk.length - 1]}]:`,
        err
      );
      // Partial failure — continue with remaining chunks
    }
  }

  return result;
}
