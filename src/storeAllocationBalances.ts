/**
 * storeAllocationBalances — hourly cron Lambda
 *
 * For every active (non-skipped, address-present) allocation:
 *   1. Calls the generic ERC-20 balance adapter
 *   2. Writes the result to the hourly time-series table in RDS
 *   3. Reconciles / promotes a daily record if none exists yet for today
 *
 * Scheduled: cron(10 * * * ? *)  — i.e. at :10 past every hour
 */

import { getCurrentUnixTimestamp } from "./utils/date";
import { wrapScheduledLambda } from "./utils/shared/wrap";
import storeAllocationBalance from "./utils/shared/storeAllocationBalance";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";
import { fetchAllocationBalance } from "./adapters/index";

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

  // Process all allocations that have an underlying token — including skip:true
  // ones.  The skip flag only controls API visibility, not DB storage.
  const active = allocations
    .filter(isActiveAllocation);

  console.log(
    `storeAllocationBalances: processing ${active.length} allocation(s) at ${timestamp}`
  );

  await Promise.all(
    active.map(async (allocation) => {
      let balanceResult: string | { balance: string; idleBalance: string };
      
      try {
        balanceResult = await withTimeout(
          fetchAllocationBalance(allocation),
          FETCH_TIMEOUT_MS,
          allocation.id
        );
      } catch (err) {
        console.error(`[${allocation.id}] Failed to fetch balance (timeout or error):`, err);
        
        // Skip allocations with hasIdle=true if adapter fails
        if (allocation.hasIdle) {
          console.error(
            `[${allocation.id}] Skipping hasIdle allocation due to adapter error`
          );
        }
        return;
      }

      // Handle idle balance allocations
      if (typeof balanceResult === "object" && "idleBalance" in balanceResult) {
        if (!allocation.hasIdle) {
          console.error(
            `[${allocation.id}] Adapter returned idle balance but allocation does not have hasIdle=true. Skipping.`
          );
          return;
        }

        const { balance, idleBalance } = balanceResult;
        const idleAllocationId = `${allocation.id}-idle`;

        // Store the active balance entry with reference to idle
        await storeAllocationBalance(
          allocation,
          timestamp,
          { balance },
          idleAllocationId
        );

        // Store the idle balance entry as a separate allocation
        await storeAllocationBalance(
          { ...allocation, id: idleAllocationId },
          timestamp,
          { balance: idleBalance }
        );
      } else {
        // Standard single-balance allocation
        if (allocation.hasIdle) {
          console.error(
            `[${allocation.id}] Allocation has hasIdle=true but adapter returned string. Skipping.`
          );
          return;
        }

        await storeAllocationBalance(
          allocation,
          timestamp,
          { balance: balanceResult }
        );
      }
    })
  );

  console.log("storeAllocationBalances: done");
};

export default wrapScheduledLambda(handler);

