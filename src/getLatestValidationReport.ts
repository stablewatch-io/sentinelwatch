/**
 * GET /latestvalidationreport
 *
 * Returns the most recent validation report from the database.
 *
 * Response shape:
 * {
 *   timestamp: string (ISO),
 *   summary: {
 *     total_response_entries: number,
 *     matched: number,
 *     value_mismatches: number,
 *     missing_in_chart: number,
 *     chart_entries_not_in_response: number
 *   },
 *   missing_in_chart: any[] | null,
 *   unmatched_chart_entries: any[]
 * }
 */

import { successResponse, wrap, IResponse } from "./utils/shared";
import { db, validationReports } from "./utils/shared/db";
import { desc } from "drizzle-orm";

const handler = async (
  _event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const latest = await db
    .select()
    .from(validationReports)
    .orderBy(desc(validationReports.timestamp))
    .limit(1);

  if (latest.length === 0) {
    return successResponse({ message: "No validation reports found in database" }, 0);
  }

  return successResponse(
    latest[0].reportData,
    5 * 60 // 5-minute cache
  );
};

export default wrap(handler);
