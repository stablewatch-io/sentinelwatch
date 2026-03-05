import {
  getDay,
  getTimestampAtStartOfDay,
  secondsInDay,
} from "../../utils/date";
import db from "../../utils/shared/db";
import getRecordClosestToTimestamp from "../../utils/shared/getRecordClosestToTimestamp";
import { getLastRecord } from "../utils/getLastRecord";
import { reconcileDailyFromHourly } from "./reconcileDailyFromHourly";
import type { AllocationConfig } from "../../allocationData/types";

type PKBuilder = (id: string) => string;

/**
 * Persist a fresh hourly balance snapshot for one allocation and, if no daily
 * record exists yet for today, promote it to the daily table as well.
 *
 * @param allocation     - allocation descriptor from allocationData/allocations.ts
 * @param unixTimestamp  - current unix timestamp (seconds)
 * @param balanceData    - arbitrary balance payload to store in JSONB
 * @param hourlyPKBuilder - fn mapping allocation id → hourly PK string
 * @param dailyPKBuilder  - fn mapping allocation id → daily PK string
 */
export default async function storeNewAllocationBalances(
  allocation: AllocationConfig,
  unixTimestamp: number,
  balanceData: Record<string, any>,
  hourlyPKBuilder: PKBuilder,
  dailyPKBuilder: PKBuilder
): Promise<void> {
  const hourlyPK = hourlyPKBuilder(allocation.id);
  const daySK = getTimestampAtStartOfDay(unixTimestamp);

  if (Object.keys(balanceData).length === 0) {
    console.warn(`[${allocation.id}] storeNewAllocationBalances: empty balanceData, skipping`);
    return;
  }

  // ----- Write hourly record -----
  const itemToStore: Record<string, any> = {
    PK: hourlyPK,
    SK: unixTimestamp,
    ...balanceData,
  };

  await db.put(itemToStore);
  console.log(`[${allocation.id}] Stored hourly balance at ${unixTimestamp}`);

  // ----- Attempt to reconcile (promote) today's daily record -----
  const { action, reason } = await reconcileDailyFromHourly(
    itemToStore,
    dailyPKBuilder,
    allocation.id
  );

  if (action === "PROMOTE") {
    console.log(`[${allocation.id}] Daily promoted – ${reason}`);
    return;
  }

  // ----- Fallback: write daily if no record exists yet for today -----
  const closestDaily = await getRecordClosestToTimestamp(
    dailyPKBuilder(allocation.id),
    unixTimestamp,
    secondsInDay * 1.5
  );

  if (getDay(closestDaily?.SK) !== getDay(unixTimestamp)) {
    await db.put({
      PK: dailyPKBuilder(allocation.id),
      SK: daySK,
      ...balanceData,
    });
    console.log(
      `[${allocation.id}] Wrote first daily record for ${new Date(daySK * 1000).toISOString().slice(0, 10)}`
    );
  }
}
