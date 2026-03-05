/**
 * Adapter router
 *
 * Determines which balance adapter to use for a given allocation:
 *
 *   1. If `allocation.module` is set, look it up in the custom adapter registry
 *      (src/adapters/allocations/).  Throws if the module name is unknown.
 *
 *   2. Otherwise, if `allocation.holdingWallet` is set, use the generic
 *      erc20Balance adapter — the common case for on-chain positions.
 *
 *   3. If neither is set, throw — the allocation is misconfigured.
 *
 * To add a new custom adapter:
 *   1. Create src/adapters/allocations/<name>.ts exporting `fetchBalance`.
 *   2. Import it here and add it to `customAdapters`.
 *   3. Set `module: "<name>"` on the allocation in allocations.ts.
 */

import type { ActiveAllocation } from "../allocationData/types";
import { fetchErc20Balance } from "./erc20/erc20Balance";
import { fetchBalance as fetchAnchorageBalance } from "./allocations/anchorage";

type BalanceFetcher = (allocation: ActiveAllocation) => Promise<string>;

const customAdapters: Record<string, BalanceFetcher> = {
  anchorage: fetchAnchorageBalance,
};

export async function fetchBalance(allocation: ActiveAllocation): Promise<string> {
  // Custom module takes priority.
  if (allocation.module) {
    const adapter = customAdapters[allocation.module];
    if (!adapter) {
      throw new Error(
        `No adapter registered for module "${allocation.module}" ` +
        `(allocation: ${allocation.id}). ` +
        `Add it to src/adapters/index.ts.`
      );
    }
    return adapter(allocation);
  }

  // Default: read balanceOf(holdingWallet) on-chain.
  if (allocation.holdingWallet) {
    return fetchErc20Balance(
      allocation as ActiveAllocation & { holdingWallet: string }
    );
  }

  throw new Error(
    `Allocation "${allocation.id}" has neither a holdingWallet nor a module — ` +
    `cannot determine which adapter to use.`
  );
}

