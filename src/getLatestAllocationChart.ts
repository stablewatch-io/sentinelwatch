/**
 * getLatestAllocationChart — API Lambda
 *
 * Returns the most recent daily allocation values snapshot.
 *
 * Query parameters:
 *   allocation  (optional) — allocation id to filter; omit for all active
 *
 * Response shape (single entry for the most recent day):
 *   {
 *     date:        <unix-ts>,
 *     allocations: { [allocationId]: { usdValue: number } },
 *     totals:      { [star: string]: number }
 *   }
 *
 * Route: GET /latestallocationchart
 */

import {
  successResponse,
  wrap,
  IResponse,
  errorResponse,
} from "./utils/shared";
import { getLastTokenPrices, getLastAllocationBalance } from "./utils/shared/getLastRecord";
import { getClosestDayStartTimestamp, secondsInHour } from "./utils/date";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function craftLatestAllocationChartResponse(
  allocationId: string | undefined
): Promise<any> {
  const visible = allocations.filter(isActiveAllocation);

  const subset = allocationId
    ? visible.filter((a) => a.id === allocationId)
    : visible;

  if (allocationId && subset.length === 0) {
    return errorResponse({ message: `Unknown allocation id: ${allocationId}` });
  }

  // ----- Load latest prices -----
  const lastDailyPrice = await getLastTokenPrices("daily");
  const lastHourlyPrice = await getLastTokenPrices("hourly");

  // Use hourly if same day and more recent
  let latestPrice = lastDailyPrice;
  if (lastDailyPrice && lastHourlyPrice) {
    if (
      lastHourlyPrice.timestamp > lastDailyPrice.timestamp &&
      lastDailyPrice.timestamp + secondsInHour * 25 > lastHourlyPrice.timestamp
    ) {
      latestPrice = lastHourlyPrice;
    }
  }

  const prices = (latestPrice?.prices as Record<string, number>) ?? {};

  // ----- Aggregate latest balances -----
  type Entry = {
    allocations: Record<string, { usdValue: number; idleUsdValue?: number }>;
    totals: Record<string, number>;
  };

  const entry: Entry = { allocations: {}, totals: {} };

  // Determine the day timestamp for the response
  let responseDayTimestamp: number | null = null;

  await Promise.all(
    subset.map(async (allocation) => {
      const lastDailyBalance = await getLastAllocationBalance(allocation.id, "daily");
      const lastHourlyBalance = await getLastAllocationBalance(allocation.id, "hourly");

      // Use hourly if same day and more recent
      let latestBalance = lastDailyBalance;
      if (lastDailyBalance && lastHourlyBalance) {
        if (
          lastHourlyBalance.timestamp > lastDailyBalance.timestamp &&
          lastDailyBalance.timestamp + secondsInHour * 25 > lastHourlyBalance.timestamp
        ) {
          latestBalance = lastHourlyBalance;
        }
      }

      if (!latestBalance) return;

      // Set response day timestamp from first allocation (they should all be same day)
      const daySK = getClosestDayStartTimestamp(latestBalance.timestamp);
      if (responseDayTimestamp === null) {
        responseDayTimestamp = daySK;
      }

      const priceKey = isActiveAllocation(allocation)
        ? (allocation.priceOverride || allocation.underlying)
        : "";

      const priceUSD = priceKey ? prices[priceKey] ?? 0 : 0;
      const rawBalance =
        latestBalance.balanceData.balance != null ? Number(latestBalance.balanceData.balance) : 0;
      let usdValue = rawBalance * priceUSD;
      let idleUsdValue = 0;

      // If this allocation has idle balances, fetch them separately
      if (allocation.hasIdle && latestBalance.idleAllocationId) {
        const idleId = latestBalance.idleAllocationId;
        
        const lastDailyIdleBalance = await getLastAllocationBalance(idleId, "daily");
        const lastHourlyIdleBalance = await getLastAllocationBalance(idleId, "hourly");

        let latestIdleBalance = lastDailyIdleBalance;
        if (lastDailyIdleBalance && lastHourlyIdleBalance) {
          if (
            lastHourlyIdleBalance.timestamp > lastDailyIdleBalance.timestamp &&
            lastDailyIdleBalance.timestamp + secondsInHour * 25 > lastHourlyIdleBalance.timestamp
          ) {
            latestIdleBalance = lastHourlyIdleBalance;
          }
        }

        if (latestIdleBalance) {
          const idlePriceKey = `${priceKey}-idle`;
          const idlePriceUSD = prices[idlePriceKey] ?? 0;
          const rawIdleBalance =
            latestIdleBalance.balanceData.balance != null
              ? Number(latestIdleBalance.balanceData.balance)
              : 0;

          idleUsdValue = rawIdleBalance * idlePriceUSD;
        }
      }

      // If allocation is marked as idle (e.g., USDS/sUSDS POL), move all value to idleUsdValue
      if (allocation.isIdle) {
        idleUsdValue = usdValue + idleUsdValue;
        usdValue = 0;
      }

      const allocationEntry: { usdValue: number; idleUsdValue?: number } = { 
        usdValue: round2(usdValue) 
      };
      if (allocation.hasIdle || allocation.isIdle) {
        allocationEntry.idleUsdValue = round2(idleUsdValue);
      }
      entry.allocations[allocation.id] = allocationEntry;

      if (allocation.star) {
        entry.totals[allocation.star] =
          (entry.totals[allocation.star] ?? 0) + usdValue + idleUsdValue;
      }
    })
  );

  // Round totals to cents
  const roundedTotals = Object.fromEntries(
    Object.entries(entry.totals).map(([s, v]) => [s, round2(v)])
  );

  return {
    date: responseDayTimestamp,
    allocations: entry.allocations,
    totals: roundedTotals,
  };
}

const handler = async (
  event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const allocationId = event.queryStringParameters?.allocation?.toLowerCase();

  const response = await craftLatestAllocationChartResponse(allocationId);

  if ("statusCode" in response) return response as IResponse;

  return successResponse(response, 5 * 60); // 5-min browser cache
};

export default wrap(handler);
