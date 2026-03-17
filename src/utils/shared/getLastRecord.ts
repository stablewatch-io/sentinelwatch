import { db, allocationBalances, tokenPrices, starFinancials } from "./db";
import { eq, and, desc } from "drizzle-orm";

/** Returns the most recent allocation balance for a given allocation and granularity */
export async function getLastAllocationBalance(
  allocationId: string,
  granularity: "hourly" | "daily"
) {
  const result = await db
    .select()
    .from(allocationBalances)
    .where(
      and(
        eq(allocationBalances.allocationId, allocationId),
        eq(allocationBalances.granularity, granularity)
      )
    )
    .orderBy(desc(allocationBalances.timestamp))
    .limit(1);

  return result[0];
}

/** Returns the most recent token prices for a given granularity */
export async function getLastTokenPrices(granularity: "hourly" | "daily") {
  const result = await db
    .select()
    .from(tokenPrices)
    .where(eq(tokenPrices.granularity, granularity))
    .orderBy(desc(tokenPrices.timestamp))
    .limit(1);

  return result[0];
}

/** Returns the most recent star financials for a given granularity */
export async function getLastStarFinancials(granularity: "hourly" | "daily") {
  const result = await db
    .select()
    .from(starFinancials)
    .where(eq(starFinancials.granularity, granularity))
    .orderBy(desc(starFinancials.timestamp))
    .limit(1);

  return result[0];
}
