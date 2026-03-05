/**
 * AllocationConfig — the raw shape of each entry in allocations.ts.
 *
 * `underlying` is optional here because some entries are still being filled in.
 * Use `ActiveAllocation` (and `isActiveAllocation()`) everywhere the underlying
 * token address is actually required (balance fetching, pricing, etc.).
 *
 * Note: there is no `blockchain` field on an allocation — the chain is
 * determined by the underlying token (`underlying.split(':')[0]`).
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
  /**
   * Reference to the underlying token, formatted as "<blockchain>:<address>"
   * — the token's id in src/allocationData/tokens.ts.
   *
   * Null / undefined while the token address is still being sourced.
   */
  underlying?: string | null;
  /** Wallet whose ERC-20 balance of the underlying token is being tracked. */
  holdingWallet: string;
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
  containsIdle?: boolean | null;
  /** If true, skip this allocation in all cron jobs. */
  skip?: boolean | null;
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
