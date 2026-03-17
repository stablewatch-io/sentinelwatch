/**
 * getAllocationPrices — API Lambda
 *
 * Returns the full historical daily price series for all tracked allocations.
 * Each entry corresponds to one day:
 *
 *   [{ date: <unix-ts>, prices: { "<blockchain>:<address>": <usd-price> } }, ...]
 *
 * The most-recent entry is patched with the latest hourly reading when it
 * falls within the same calendar day, so callers always see fresh data.
 *
 * Route: GET /allocationprices
 */

import type { APIGatewayEvent } from "aws-lambda";
import { successResponse, wrap, IResponse } from "./utils/shared";
import { db, tokenPrices } from "./utils/shared/db";
import { getLastTokenPrices } from "./utils/shared/getLastRecord";
import { eq, asc } from "drizzle-orm";
import { secondsInHour } from "./utils/date";

export async function craftAllocationPricesResponse() {
  const historicalPrices = await db
    .select()
    .from(tokenPrices)
    .where(eq(tokenPrices.granularity, "daily"))
    .orderBy(asc(tokenPrices.timestamp));

  if (historicalPrices.length === 0) {
    return [];
  }

  // Patch the last daily entry with the most recent hourly record if it
  // belongs to the same day (within a 25-hour window).
  const lastHourly = await getLastTokenPrices("hourly");
  const lastDaily = historicalPrices[historicalPrices.length - 1];

  if (
    lastHourly !== undefined &&
    lastHourly.timestamp > lastDaily.timestamp &&
    lastDaily.timestamp + secondsInHour * 25 > lastHourly.timestamp
  ) {
    historicalPrices[historicalPrices.length - 1] = {
      ...lastHourly,
      timestamp: lastDaily.timestamp,
    };
  }

  return historicalPrices
    .map((item) =>
      typeof item === "object" && item.prices !== undefined
        ? { date: item.timestamp, prices: item.prices }
        : null
    )
    .filter(Boolean);
}

const handler = async (
  _event: APIGatewayEvent
): Promise<IResponse> => {
  const data = await craftAllocationPricesResponse();
  return successResponse(data, 30 * 60); // 30-min browser cache
};

export default wrap(handler);

