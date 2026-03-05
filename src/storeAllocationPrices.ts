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
  getDay,
  getTimestampAtStartOfDay,
  secondsInDay,
} from "./utils/date";
import db from "./utils/shared/db";
import getRecordClosestToTimestamp from "./utils/shared/getRecordClosestToTimestamp";
import {
  hourlyAllocationPrices,
  dailyAllocationPrices,
} from "./peggedAssets/utils/getLastRecord";
import { getPrices } from "./utils/getPrices";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";

const handler = async (_event: any): Promise<void> => {
  const timestamp = getCurrentUnixTimestamp();
  const daySK = getTimestampAtStartOfDay(timestamp);

  // Include skip:true allocations — skip only controls API visibility.
  const active = allocations
    .filter(isActiveAllocation);

  // Deduplicate: price is per unique underlying token, not per allocation
  const uniqueTokenIds = [...new Set(active.map((a) => a.underlying))];

  console.log(
    `storeAllocationPrices: fetching prices for ${uniqueTokenIds.length} unique token(s) ` +
    `(from ${active.length} active allocation(s)) at ${timestamp}`
  );

  // ----- Fetch prices from DefiLlama -----
  const prices = await getPrices(uniqueTokenIds);

  const priceCount = Object.keys(prices).length;
  console.log(`storeAllocationPrices: received ${priceCount} price(s)`);

  // ----- Write hourly record -----
  await db.put({
    PK: hourlyAllocationPrices,
    SK: timestamp,
    prices,
  });

  // ----- Write daily record (first write of the day only) -----
  const closestDaily = await getRecordClosestToTimestamp(
    dailyAllocationPrices,
    timestamp,
    secondsInDay * 1.5
  );

  if (getDay(closestDaily?.SK) !== getDay(timestamp)) {
    await db.put({
      PK: dailyAllocationPrices,
      SK: daySK,
      prices,
    });
    console.log(
      `storeAllocationPrices: wrote daily price record for ${new Date(daySK * 1000).toISOString().slice(0, 10)}`
    );
  }

  console.log("storeAllocationPrices: done");
};

export default wrapScheduledLambda(handler);

