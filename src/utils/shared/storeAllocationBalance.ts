import { getDay, getTimestampAtStartOfDay } from "../date";
import { db, allocationBalances } from "./db";
import { eq, and } from "drizzle-orm";
import type { AllocationConfig } from "../../allocationData/types";

/**
 * Persist a fresh hourly balance snapshot for one allocation and, if no daily
 * record exists yet for today, promote it to the daily table as well.
 *
 * @param allocation        - allocation descriptor from allocationData/allocations.ts
 * @param unixTimestamp     - current unix timestamp (seconds)
 * @param balanceData       - arbitrary balance payload to store in JSONB
 * @param idleAllocationId  - optional reference to the corresponding idle allocation entry
 */
export default async function storeAllocationBalance(
  allocation: AllocationConfig,
  unixTimestamp: number,
  balanceData: Record<string, any>,
  idleAllocationId?: string
): Promise<void> {
  const daySK = getTimestampAtStartOfDay(unixTimestamp);

  if (Object.keys(balanceData).length === 0) {
    console.warn(`[${allocation.id}] storeAllocationBalance: empty balanceData, skipping`);
    return;
  }

  // ----- Write hourly record -----
  await db
    .insert(allocationBalances)
    .values({
      allocationId: allocation.id,
      timestamp: unixTimestamp,
      granularity: "hourly",
      balanceData,
      idleAllocationId: idleAllocationId || null,
    })
    .onConflictDoUpdate({
      target: [
        allocationBalances.allocationId,
        allocationBalances.granularity,
        allocationBalances.timestamp,
      ],
      set: { balanceData, idleAllocationId: idleAllocationId || null },
    });
  console.log(`[${allocation.id}] Stored hourly balance at ${unixTimestamp}`);

  // ----- Check if daily record exists for today -----
  const existingDaily = await db
    .select()
    .from(allocationBalances)
    .where(
      and(
        eq(allocationBalances.allocationId, allocation.id),
        eq(allocationBalances.granularity, "daily"),
        eq(allocationBalances.timestamp, daySK)
      )
    )
    .limit(1);

  // ----- Write daily record if it doesn't exist -----
  if (existingDaily.length === 0) {
    await db
      .insert(allocationBalances)
      .values({
        allocationId: allocation.id,
        timestamp: daySK,
        granularity: "daily",
        balanceData,
        idleAllocationId: idleAllocationId || null,
      })
      .onConflictDoNothing();
    console.log(
      `[${allocation.id}] Wrote first daily record for ${new Date(daySK * 1000).toISOString().slice(0, 10)}`
    );
  }
}
