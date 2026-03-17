/**
 * storeAllocationPrices — hourly cron Lambda
 *
 * 1. Collects all active (address-present, non-skipped) allocations.
 * 2. Fetches current USD prices from DefiLlama for every unique
 *    blockchain:address pair.
 * 3. Writes an hourly price record to RDS  (PK = hourlyAllocationPrices).
 * 4. If no daily record exists yet for today, writes one
 *    (PK = dailyAllocationPrices).
 *
 * Prices are stored as a map: { "<blockchain>:<address>": <usd-price> }
 *
 * Scheduled: cron(15 * * * ? *)  — i.e. at :15 past every hour
 */

import { wrapScheduledLambda } from "./utils/shared/wrap";
import {
  getCurrentUnixTimestamp,
  getTimestampAtStartOfDay,
} from "./utils/date";
import { db, tokenPrices } from "./utils/shared/db";
import { getPrices } from "./utils/getPrices";
import { getCustomPrices } from "./adapters/prices";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";

const handler = async (_event: any): Promise<void> => {
  const timestamp = getCurrentUnixTimestamp();
  const daySK = getTimestampAtStartOfDay(timestamp);

  // Include skip:true allocations — skip only controls API visibility.
  const active = allocations
    .filter(isActiveAllocation);

  // Deduplicate: price is per unique underlying token, not per allocation
  // Include priceOverride tokens if set (for cross-chain pricing)
  // For hasIdle allocations, also include the idle price key
  const allTokenIds = active.flatMap((a) => {
    const baseIds = a.priceOverride ? [a.underlying, a.priceOverride] : [a.underlying];
    // For hasIdle allocations, we need the idle price key as well
    if (a.hasIdle) {
      const priceKey = a.priceOverride || a.underlying;
      return [...baseIds, `${priceKey}-idle`];
    }
    return baseIds;
  });
  const uniqueTokenIds = [...new Set(allTokenIds)];

  console.log(
    `storeAllocationPrices: fetching prices for ${uniqueTokenIds.length} unique token(s) ` +
    `(from ${active.length} active allocation(s)) at ${timestamp}`
  );

  // ----- Fetch prices from DefiLlama -----
  const llamaPrices = await getPrices(uniqueTokenIds);

  const llamaCount = Object.keys(llamaPrices).length;
  console.log(`storeAllocationPrices: DefiLlama returned ${llamaCount} price(s)`);

  // ----- Fill missing prices via custom adapters (Chronicle, Redstone, Morpho vaults, hardcoded) -----
  const missingIds = uniqueTokenIds.filter((id) => llamaPrices[id] == null);
  const customPrices =
    missingIds.length > 0 ? await getCustomPrices(missingIds, llamaPrices) : {};

  if (missingIds.length > 0) {
    console.log(
      `storeAllocationPrices: custom adapters resolved ${Object.keys(customPrices).length}` +
      ` of ${missingIds.length} missing price(s)`
    );
  }

  const prices = { ...llamaPrices, ...customPrices };

  const priceCount = Object.keys(prices).length;
  console.log(`storeAllocationPrices: total prices resolved: ${priceCount}`);

  // Log each individual token price (including 0 prices)
  for (const tokenId of uniqueTokenIds) {
    const price = prices[tokenId];
    if (price !== undefined) {
      console.log(`storeAllocationPrices: [${tokenId}] = ${price}`);
    } else {
      console.warn(`storeAllocationPrices: [${tokenId}] = MISSING`);
    }
  }

  // ----- Write hourly record -----
  await db
    .insert(tokenPrices)
    .values({
      timestamp,
      granularity: "hourly",
      prices,
    })
    .onConflictDoUpdate({
      target: [tokenPrices.granularity, tokenPrices.timestamp],
      set: { prices },
    });

  // ----- Write daily record (always overwrite so the last run of the day wins) -----
  // We do NOT use "first write only" here because the first hourly run of the day
  // may have adapter errors (returning 0 for newly-added tokens).  Overwriting on
  // each run means the daily record always reflects the most recent — and therefore
  // most complete — set of prices for that calendar day.
  await db
    .insert(tokenPrices)
    .values({
      timestamp: daySK,
      granularity: "daily",
      prices,
    })
    .onConflictDoUpdate({
      target: [tokenPrices.granularity, tokenPrices.timestamp],
      set: { prices },
    });
  console.log(
    `storeAllocationPrices: wrote/updated daily price record for ${new Date(daySK * 1000).toISOString().slice(0, 10)}`
  );

  console.log("storeAllocationPrices: done");
};

export default wrapScheduledLambda(handler);

