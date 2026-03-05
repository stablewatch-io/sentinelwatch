/**
 * anchorage — custom balance adapter
 *
 * Anchorage is an off-chain custodian; there is no on-chain wallet to query.
 * This adapter returns a hardcoded balance that must be updated manually
 * whenever the actual position size changes.
 */

import type { ActiveAllocation } from "../../allocationData/types";

/** Hardcoded AUM for the Anchorage custody position (in USDC, human-readable). */
const HARDCODED_BALANCE = "150000000";

export async function fetchBalance(_allocation: ActiveAllocation): Promise<string> {
  return HARDCODED_BALANCE;
}

