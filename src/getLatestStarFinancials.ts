/**
 * GET /lateststarfinancials
 *
 * Returns the most-recent hourly snapshot of star financials.
 *
 * Response shape:
 * {
 *   timestamp: number,
 *   spark: { debt: string, rc: string },
 *   grove:  { debt: string, rc: string },
 *   obex:   { debt: string, rc: string }
 * }
 */
import { successResponse, wrap, IResponse } from "./utils/shared";
import {
  getLastRecord,
  hourlyStarFinancials,
} from "./peggedAssets/utils/getLastRecord";
import { stars } from "./starData/stars";

const handler = async (
  _event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const latest = await getLastRecord(hourlyStarFinancials);

  const storedData: Record<string, { debt?: string; rc?: string }> =
    latest?.data ?? {};

  const result: Record<string, { debt: string | null; rc: string | null }> =
    {};

  for (const star of stars) {
    if (star.skip) continue;
    const entry = storedData[star.id] ?? {};
    result[star.id] = {
      debt: entry.debt ?? null,
      rc: entry.rc ?? null,
    };
  }

  return successResponse(
    {
      timestamp: latest?.SK ?? null,
      ...result,
    },
    60 // 1-minute cache
  );
};

export default wrap(handler);
