import db from "../../utils/shared/db";

/** Returns the most-recent row for a given PK. */
export function getLastRecord(PK: string): Promise<Record<string, any> | undefined> {
  return db
    .query({
      ExpressionAttributeValues: { ":pk": PK },
      KeyConditionExpression: "PK = :pk",
      Limit: 1,
      ScanIndexForward: false,
    })
    .then((res) => res.Items?.[0]);
}

// ---------------------------------------------------------------------------
// PK key builders — keep these as named constants so all callers stay in sync.
// ---------------------------------------------------------------------------

/** Hourly balance snapshots for one allocation (one row per hour). */
export const hourlyAllocationBalances = (allocationId: string) =>
  `hourly#${allocationId}`;

/** Daily balance snapshots derived from the best hourly reading each day. */
export const dailyAllocationBalances = (allocationId: string) =>
  `daily#${allocationId}`;

/** All hourly price readings (shared across all allocations). */
export const hourlyAllocationPrices = "hourlyPrices";

/** One row per day with the USD price snapshot for all tracked assets. */
export const dailyAllocationPrices = "dailyPrices";

/** Hourly star financials snapshots (debt + rc, one row per hour, all stars). */
export const hourlyStarFinancials = "hourlyStarFinancials";

/** One row per day with the star financials snapshot. */
export const dailyStarFinancials = "dailyStarFinancials";
