/**
 * getAllocationChart — API Lambda
 *
 * Returns a daily time-series of allocation balances and USD values.
 *
 * Query parameters:
 *   allocation  (optional) — allocation id to filter; omit for aggregate
 *   startts     (optional) — unix timestamp; exclude entries before this date
 *
 * Response shape (one entry per day):
 *   [{
 *     date:     <unix-ts>,
 *     balances: { [allocationId]: { balance: number } },
 *     totalUSD: number,
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
import { getHistoricalValues } from "./utils/shared/db";
import {
  getLastRecord,
  dailyAllocationBalances,
  hourlyAllocationBalances,
  dailyAllocationPrices,
  hourlyAllocationPrices,
} from "./peggedAssets/utils/getLastRecord";
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
  const subset = allocationId
    ? allocations.filter((a) => a.id === allocationId)
    : allocations.filter(isActiveAllocation).filter((a) => !a.skip);

  if (allocationId && subset.length === 0) {
    return errorResponse({ message: `Unknown allocation id: ${allocationId}` });
  }

  const startTs = startTimestamp ? parseInt(startTimestamp, 10) : 0;

  // ----- Load daily price series -----
  const dailyPricesHistory = await getHistoricalValues(dailyAllocationPrices);
  const lastHourlyPrice = await getLastRecord(hourlyAllocationPrices);

  // Patch latest daily price entry with most-recent hourly if same day
  if (dailyPricesHistory.length > 0 && lastHourlyPrice) {
    const lastDaily = dailyPricesHistory[dailyPricesHistory.length - 1];
    if (
      lastHourlyPrice.SK > lastDaily.SK &&
      lastDaily.SK + secondsInHour * 25 > lastHourlyPrice.SK
    ) {
      dailyPricesHistory[dailyPricesHistory.length - 1] = {
        ...lastHourlyPrice,
        SK: lastDaily.SK,
      };
    }
  }

  const priceSKs = dailyPricesHistory.map((r) => r.SK as number);

  /**
   * Look up the price for a given allocation at a specific timestamp.
   * Prices are keyed as "<blockchain>:<address>" in the stored price map.
   */
  function getPriceAt(priceKey: string, timestamp: number): number {
    if (dailyPricesHistory.length === 0) return 0;
    const idx = findClosest(priceSKs, timestamp);
    return (dailyPricesHistory[idx]?.prices?.[priceKey] as number) ?? 0;
  }

  // ----- Aggregate balances per calendar day -----
  type DayEntry = {
    balances: Record<string, { balance: number }>;
    totalUSD: number;
  };

  const byDay: Record<number, DayEntry> = {};

  await Promise.all(
    subset.map(async (allocation) => {
      const history = await getHistoricalValues(
        dailyAllocationBalances(allocation.id)
      );

      // Patch with latest hourly if same day
      const lastHourlyBalance = await getLastRecord(
        hourlyAllocationBalances(allocation.id)
      );
      if (history.length > 0 && lastHourlyBalance) {
        const lastD = history[history.length - 1];
        if (
          lastHourlyBalance.SK > lastD.SK &&
          lastD.SK + secondsInHour * 25 > lastHourlyBalance.SK
        ) {
          history[history.length - 1] = { ...lastHourlyBalance, SK: lastD.SK };
        }
      }

      // Price key is the underlying token id ("blockchain:address") —
      // matches exactly what getPrices() stores.
      const priceKey = isActiveAllocation(allocation) ? allocation.underlying : "";

      for (const item of history) {
        const daySK = getClosestDayStartTimestamp(item.SK as number);
        if (daySK < startTs) continue;

        const priceUSD = priceKey ? getPriceAt(priceKey, daySK) : 0;
        const rawBalance =
          typeof item.balance === "number" ? item.balance : 0;

        if (!byDay[daySK]) {
          byDay[daySK] = { balances: {}, totalUSD: 0 };
        }

        byDay[daySK].balances[allocation.id] = { balance: rawBalance };
        byDay[daySK].totalUSD += rawBalance * priceUSD;
      }
    })
  );

  // ----- Shape response -----
  return Object.entries(byDay)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([timestamp, entry]) => ({
      date: Number(timestamp),
      balances: entry.balances,
      totalUSD: round2(entry.totalUSD),
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

