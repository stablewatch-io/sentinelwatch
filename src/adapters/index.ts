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
 * 
 * For allocations with hasIdle=true:
 *   - Adapter must return {balance: string, idleBalance: string}
 *   - Adapter is registered in `customIdleAdapters`
 *   - If no adapter is registered, the allocation is skipped with an error log
 */

import type { ActiveAllocation } from "../allocationData/types";
import { fetchErc20Balance } from "./erc20/erc20Balance";
import { fetchBalance as fetchAnchorageBalance } from "./allocations/anchorage";
import { fetchBalance as fetchUniswapV3PositionBalance } from "./allocations/uniswapV3Position";
import { fetchBalance as fetchSparklendSupplyWithIdleBalance } from "./allocations/sparklendSupplyWithIdle";
import { fetchBalance as fetchCurveLpWithIdleBalance } from "./allocations/curveLpWithIdle";

type BalanceFetcher = (allocation: ActiveAllocation) => Promise<string>;
type IdleBalanceFetcher = (allocation: ActiveAllocation) => Promise<{ balance: string; idleBalance: string }>;

const customAdapters: Record<string, BalanceFetcher> = {
  anchorage: fetchAnchorageBalance,
  uniswapV3Position: fetchUniswapV3PositionBalance,
};

const customIdleAdapters: Record<string, IdleBalanceFetcher> = {
  sparklendSupplyWithIdle: fetchSparklendSupplyWithIdleBalance,
  curveLpWithIdle: fetchCurveLpWithIdleBalance,
};

export async function fetchAllocationBalance(
  allocation: ActiveAllocation
): Promise<string | { balance: string; idleBalance: string }> {
  let adapterName: string;
  
  // For allocations with hasIdle, require a custom idle adapter
  if (allocation.hasIdle) {
    if (!allocation.module) {
      throw new Error(
        `Allocation "${allocation.id}" has hasIdle=true but no module specified. ` +
        `Idle allocations require a custom adapter.`
      );
    }
    
    adapterName = `idle:${allocation.module}`;
    const idleAdapter = customIdleAdapters[allocation.module];
    
    if (!idleAdapter) {
      throw new Error(
        `No idle adapter registered for module "${allocation.module}" ` +
        `(allocation: ${allocation.id}). ` +
        `Add it to customIdleAdapters in src/adapters/index.ts.`
      );
    }
    
    console.log(`[${allocation.id}] fetching balance using ${adapterName}`);
    try {
      const result = await idleAdapter(allocation as any);
      
      // Validate the adapter returns the correct shape
      if (
        typeof result !== "object" ||
        typeof result.balance !== "string" ||
        typeof result.idleBalance !== "string"
      ) {
        throw new Error(
          `Idle adapter for module "${allocation.module}" returned invalid format. ` +
          `Expected {balance: string, idleBalance: string}, got: ${JSON.stringify(result)}`
        );
      }
      
      console.log(`[${allocation.id}] balance=${result.balance}, idleBalance=${result.idleBalance}`);
      return result;
    } catch (err) {
      console.error(`[${allocation.id}] ${adapterName} failed:`, err);
      throw err;
    }
  }
  
  // Standard (non-idle) adapters
  let adapterFn: BalanceFetcher;

  if (allocation.module) {
    adapterName = `custom:${allocation.module}`;
    const adapter = customAdapters[allocation.module];
    if (!adapter) {
      throw new Error(
        `No adapter registered for module "${allocation.module}" ` +
        `(allocation: ${allocation.id}). ` +
        `Add it to src/adapters/index.ts.`
      );
    }
    adapterFn = adapter;
  } else if (allocation.holdingWallet) {
    adapterName = "erc20Balance";
    adapterFn = fetchErc20Balance as BalanceFetcher;
  } else {
    throw new Error(
      `Allocation "${allocation.id}" has neither a holdingWallet nor a module — ` +
      `cannot determine which adapter to use.`
    );
  }

  console.log(`[${allocation.id}] fetching balance using ${adapterName}`);
  try {
    const balance = await adapterFn(allocation as any);
    console.log(`[${allocation.id}] balance=${balance}`);
    return balance;
  } catch (err) {
    console.error(`[${allocation.id}] ${adapterName} failed:`, err);
    throw err;
  }
}
