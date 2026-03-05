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
import { getHistoricalValues } from "./utils/shared/db";
import {
  getLastRecord,
  dailyAllocationPrices,
  hourlyAllocationPrices,
} from "./peggedAssets/utils/getLastRecord";
import { secondsInHour } from "./utils/date";

export async function craftAllocationPricesResponse() {
  const historicalPrices = await getHistoricalValues(dailyAllocationPrices);

  if (historicalPrices.length === 0) {
    return [];
  }

  // Patch the last daily entry with the most recent hourly record if it
  // belongs to the same day (within a 25-hour window).
  const lastHourly = await getLastRecord(hourlyAllocationPrices);
  const lastDaily = historicalPrices[historicalPrices.length - 1];

  if (
    lastHourly !== undefined &&
    lastHourly.SK > lastDaily.SK &&
    lastDaily.SK + secondsInHour * 25 > lastHourly.SK
  ) {
    historicalPrices[historicalPrices.length - 1] = {
      ...lastHourly,
      SK: lastDaily.SK,
    };
  }

  return historicalPrices
    .map((item) =>
      typeof item === "object" && item.prices !== undefined
        ? { date: item.SK, prices: item.prices }
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

