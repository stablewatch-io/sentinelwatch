/**
 * AllocationConfig — the raw shape of each entry in allocations.ts.
 *
 * `underlying` is optional here because some entries are still being filled in.
 * Use `ActiveAllocation` (and `isActiveAllocation()`) everywhere the underlying
 * token address is actually required (balance fetching, pricing, etc.).
 */
export type AllocationConfig = {
  /** Unique stable identifier — used as the DB partition key suffix. */
  id: string;
  /** Human-readable position name (e.g. "Spark Prime USDC 1"). */
  name: string;
  /** Protocol this allocation lives in (e.g. "morpho", "aave", "maple"). */
  protocol: string;
  /** Grouping label (e.g. "Spark", "Grove", "Obex"). */
  star: string;
  /** Blockchain network (e.g. "ethereum", "base", "avalanche"). */
  blockchain: string;
  /** Type of allocation: "allocation", "asset", or "PSM3". */
  type: string;
  /**
   * Reference to the underlying token, formatted as "<blockchain>:<address>"
   * — the token's id in src/allocationData/tokens.ts.
   *
   * Null / undefined while the token address is still being sourced.
   */
  underlying?: string | null;
  /**
   * Wallet whose ERC-20 balance of the underlying token is being tracked.
   * When present (and `module` is absent), the generic erc20Balance adapter
   * is used automatically.  Omit only when a custom `module` is specified.
   */
  holdingWallet?: string | null;
  /**
   * Name of the custom balance adapter in src/adapters/allocations/.
   * When set, this adapter is used instead of the default erc20Balance logic,
   * regardless of whether holdingWallet is also present.
   */
  module?: string | null;
  /** ISO-8601 date string for when tracking started (e.g. "2024-01-15"). */
  startDate?: string | null;
  /** True if this allocation is a yield-bearing share. */
  isYBS?: boolean | null;
  /** True if this allocation is a lending market position. */
  isLending?: boolean | null;
  /** True if rewards are distributed via Merkle drops. */
  isMerkle?: boolean | null;
  /** True if this allocation is an LP position. */
  isLP?: boolean | null;
  /** True if some portion sits idle (not deployed). */
  hasIdle?: boolean | null;
  /** True if this entire allocation should be treated as idle (e.g., USDS/sUSDS POL). */
  isIdle?: boolean | null;
  /** True if this allocation has RRC (Risk Review Committee) oversight. */
  hasRRC?: boolean | null;
  market?: string | null;
  /**
   * For Uniswap V3 LP positions: the pool address.
   */
  poolAddress?: string | null;
  /**
   * For Uniswap V3 LP positions: token0 id in "<blockchain>:<address>" format.
   */
  token0?: string | null;
  /**
   * For Uniswap V3 LP positions: token1 id in "<blockchain>:<address>" format.
   */
  token1?: string | null;
  /**
   * For Uniswap V3 LP positions: fee tier (e.g., 3000 = 0.30%).
   */
  feeTier?: number | null;
  /**
   * Optional price override: when set, the pricing pipeline will use this
   * token address instead of `underlying` for USD price lookups.
   * Format: "<blockchain>:<address>" (must match a key in tokens.ts).
   * 
   * Use case: cross-chain tokens where one chain has better price feeds
   * (e.g., use Ethereum USDS price for USDS on all chains).
   */
  priceOverride?: string | null;
};

/**
 * An allocation whose `underlying` token reference has been confirmed non-null.
 * This is the type used by adapters and the pricing pipeline.
 */
export type ActiveAllocation = AllocationConfig & { underlying: string };

/** Runtime type-guard — filters out entries with no underlying token set. */
export function isActiveAllocation(a: AllocationConfig): a is ActiveAllocation {
  return typeof a.underlying === "string" && a.underlying.length > 0;
}
