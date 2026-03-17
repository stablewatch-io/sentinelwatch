/**
 * getLatestPrices — API Lambda
 *
 * Returns the single most-recent price snapshot from the DB.
 * Useful for verifying that the price cron job is running correctly.
 *
 * Response shape:
 *   {
 *     timestamp: <unix-ts>,
 *     prices: { "<blockchain>:<address>": <usd-price>, ... }
 *   }
 *
 * Route: GET /latestprices
 */

import { successResponse, wrap, IResponse } from "./utils/shared";
import { getLastTokenPrices } from "./utils/shared/getLastRecord";

const handler = async (
  _event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const latest = await getLastTokenPrices("hourly");

  if (!latest) {
    return successResponse({ message: "No price data in DB yet" }, 0);
  }

  return successResponse(
    {
      timestamp: latest.timestamp,
      prices: latest.prices ?? {},
    },
    60 // 1-min cache — this is a debug/test endpoint
  );
};

export default wrap(handler);

