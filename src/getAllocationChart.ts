/**
 * getAllocationChart — API Lambda
 *
 * Returns a daily time-series of allocation USD values.
 *
 * Query parameters:
 *   allocation  (optional) — allocation id to filter; omit for all active
 *   startts     (optional) — unix timestamp; exclude entries before this date
 *
 * Response shape (one entry per day):
 *   [{
 *     date:        <unix-ts>,
 *     allocations: { [allocationId]: { usdValue: number } },
 *     totals:      { [star: string]: number },   // e.g. { "Spark": 1.2e9, "Grove": 4e8 }
 *   }, ...]
 *
 * Route: GET /allocationchart
 */

import {
  successResponse,
  wrap,
  IResponse,
  errorResponse,
} from "./utils/shared";
import { db, tokenPrices, allocationBalances } from "./utils/shared/db";
import { getLastTokenPrices, getLastAllocationBalance } from "./utils/shared/getLastRecord";
import { eq, and, asc } from "drizzle-orm";
import { getClosestDayStartTimestamp, secondsInHour } from "./utils/date";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Binary-search for the index of the entry in `sorted` closest to `target`. */
function findClosest(sorted: number[], target: number): number {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (
    lo > 0 &&
    Math.abs(sorted[lo - 1] - target) <= Math.abs(sorted[lo] - target)
  ) {
    return lo - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Core response builder
// ---------------------------------------------------------------------------

export async function craftAllocationChartResponse(
  allocationId: string | undefined,
  startTimestamp: string | undefined
): Promise<any> {
  const visible = allocations.filter(isActiveAllocation);

  const subset = allocationId
    ? visible.filter((a) => a.id === allocationId)
    : visible;

  if (allocationId && subset.length === 0) {
    return errorResponse({ message: `Unknown allocation id: ${allocationId}` });
  }

  const startTs = startTimestamp ? parseInt(startTimestamp, 10) : 0;

  // ----- Load daily price series -----
  const dailyPricesHistory = await db
    .select()
    .from(tokenPrices)
    .where(eq(tokenPrices.granularity, "daily"))
    .orderBy(asc(tokenPrices.timestamp));

  const lastHourlyPrice = await getLastTokenPrices("hourly");

  // Patch latest daily price entry with most-recent hourly if same day
  if (dailyPricesHistory.length > 0 && lastHourlyPrice) {
    const lastDaily = dailyPricesHistory[dailyPricesHistory.length - 1];
    if (
      lastHourlyPrice.timestamp > lastDaily.timestamp &&
      lastDaily.timestamp + secondsInHour * 25 > lastHourlyPrice.timestamp
    ) {
      dailyPricesHistory[dailyPricesHistory.length - 1] = {
        ...lastHourlyPrice,
        timestamp: lastDaily.timestamp,
      };
    }
  }

  const priceSKs = dailyPricesHistory.map((r) => r.timestamp);

  /**
   * Look up the USD price for a token id ("blockchain:address") at a
   * specific day-start timestamp.  Returns 0 if no price data is available.
   */
  function getPriceAt(tokenId: string, timestamp: number): number {
    if (dailyPricesHistory.length === 0) return 0;
    const idx = findClosest(priceSKs, timestamp);
    return (dailyPricesHistory[idx]?.prices?.[tokenId] as number) ?? 0;
  }

  // ----- Aggregate per calendar day -----
  type DayEntry = {
    /** usdValue per allocation — rounded to cents at write time */
    allocations: Record<string, { usdValue: number }>;
    /**
     * Accumulated unrounded USD per "star" group.
     * Rounded to cents only when serialised in the final response.
     */
    totals: Record<string, number>;
  };

  const byDay: Record<number, DayEntry> = {};

  await Promise.all(
    subset.map(async (allocation) => {
      const history = await db
        .select()
        .from(allocationBalances)
        .where(
          and(
            eq(allocationBalances.allocationId, allocation.id),
            eq(allocationBalances.granularity, "daily")
          )
        )
        .orderBy(asc(allocationBalances.timestamp));

      // Patch with latest hourly if same day
      const lastHourlyBalance = await getLastAllocationBalance(allocation.id, "hourly");
      if (history.length > 0 && lastHourlyBalance) {
        const lastD = history[history.length - 1];
        if (
          lastHourlyBalance.timestamp > lastD.timestamp &&
          lastD.timestamp + secondsInHour * 25 > lastHourlyBalance.timestamp
        ) {
          history[history.length - 1] = { 
            ...lastHourlyBalance, 
            timestamp: lastD.timestamp 
          };
        }
      }

      // Price key is the underlying token id ("blockchain:address")
      // Use priceOverride if set (for cross-chain tokens with better price feeds on one chain)
      const priceKey = isActiveAllocation(allocation)
        ? (allocation.priceOverride || allocation.underlying)
        : "";

      const { star } = allocation;

      for (const item of history) {
        const daySK = getClosestDayStartTimestamp(item.timestamp);
        if (daySK < startTs) continue;

        const priceUSD = priceKey ? getPriceAt(priceKey, daySK) : 0;
        // balance is stored as a decimal string ("86639871.842302") to preserve
        // full on-chain precision; convert to number only here for arithmetic.
        const rawBalance =
          item.balanceData.balance != null ? Number(item.balanceData.balance) : 0;

        // Keep full precision for totals accumulation; round per-allocation
        // value to cents for display.
        const usdValue = rawBalance * priceUSD;

        if (!byDay[daySK]) {
          byDay[daySK] = { allocations: {}, totals: {} };
        }

        byDay[daySK].allocations[allocation.id] = { usdValue: round2(usdValue) };

        if (star) {
          byDay[daySK].totals[star] =
            (byDay[daySK].totals[star] ?? 0) + usdValue;
        }
      }
    })
  );

  // ----- Shape response -----
  return Object.entries(byDay)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([timestamp, entry]) => ({
      date: Number(timestamp),
      allocations: entry.allocations,
      totals: Object.fromEntries(
        Object.entries(entry.totals).map(([s, v]) => [s, round2(v)])
      ),
    }));
}

// ---------------------------------------------------------------------------
// Lambda handler
// ---------------------------------------------------------------------------

const handler = async (
  event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const allocationId = event.queryStringParameters?.allocation?.toLowerCase();
  const startTimestamp = event.queryStringParameters?.startts;

  const response = await craftAllocationChartResponse(allocationId, startTimestamp);

  if ("statusCode" in response) return response as IResponse;

  return successResponse(response, 10 * 60); // 10-min browser cache
};

export default wrap(handler);
