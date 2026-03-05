/**
 * storeAllocationBalances — hourly cron Lambda
 *
 * For every active (non-skipped, address-present) allocation:
 *   1. Calls the generic ERC-20 balance adapter
 *   2. Writes the result to the hourly time-series table in RDS
 *   3. Reconciles / promotes a daily record if none exists yet for today
 *
 * Scheduled: cron(40 * * * ? *)  — i.e. at :40 past every hour
 */

import { getCurrentUnixTimestamp } from "./utils/date";
import { wrapScheduledLambda } from "./utils/shared/wrap";
import {
  hourlyAllocationBalances,
  dailyAllocationBalances,
} from "./peggedAssets/utils/getLastRecord";
import storeNewAllocationBalances from "./peggedAssets/storePeggedAssets/storeNewPeggedBalances";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";
import { fetchErc20Balance } from "./adapters/erc20Balance";

const FETCH_TIMEOUT_MS = 30_000; // 30 s per allocation

/** Run a promise with a hard timeout. */
function withTimeout<T>(prom: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    prom,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

const handler = async (_event: any): Promise<void> => {
  const timestamp = getCurrentUnixTimestamp();

  // Only process allocations that have an address and aren't skipped
  const active = allocations
    .filter(isActiveAllocation)
    .filter((a) => !a.skip);

  console.log(
    `storeAllocationBalances: processing ${active.length} allocation(s) at ${timestamp}`
  );

  await Promise.all(
    active.map(async (allocation) => {
      let balance: string;
      try {
        balance = await withTimeout(
          fetchErc20Balance(allocation),
          FETCH_TIMEOUT_MS,
          allocation.id
        );
        console.log(`[${allocation.id}] balance = ${balance}`);
      } catch (err) {
        console.error(`[${allocation.id}] Failed to fetch balance:`, err);
        return;
      }

      await storeNewAllocationBalances(
        allocation,
        timestamp,
        { balance },
        hourlyAllocationBalances,
        dailyAllocationBalances
      );
    })
  );

  console.log("storeAllocationBalances: done");
};

export default wrapScheduledLambda(handler);

