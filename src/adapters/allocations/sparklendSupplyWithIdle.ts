/**
 * Sparklend Supply Balance Adapter (with Idle)
 *
 * Generic adapter for Sparklend lending positions that separate active and idle balances.
 * Fetches the active balance of the spToken and the idle balance separately.
 * For now, returns 0 as idleBalance as a placeholder.
 */

import { ethers } from "ethers";
import type { ActiveAllocation } from "../../allocationData/types";
import { getProvider } from "../../utils/providers";
import { tokens as tokenRegistry } from "../../allocationData/tokens";

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

export async function fetchBalance(
  allocation: ActiveAllocation
): Promise<{ balance: string; idleBalance: string }> {
  if (!allocation.holdingWallet) {
    throw new Error(`sparklendSupplyWithIdle adapter requires holdingWallet for allocation ${allocation.id}`);
  }

  const token = tokenRegistry[allocation.underlying];
  if (!token) {
    throw new Error(`Token "${allocation.underlying}" not found in registry`);
  }

  const provider = getProvider(token.blockchain);
  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);

  // Fetch active balance
  const balanceRaw = await contract.balanceOf(allocation.holdingWallet);
  const decimals = token.decimals != null ? token.decimals : await contract.decimals();
  const balance = ethers.formatUnits(balanceRaw, decimals);

  // TODO: Implement actual idle balance fetching logic
  const idleBalance = "0";

  return { balance, idleBalance };
}
