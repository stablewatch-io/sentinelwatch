/**
 * erc20Balance — generic ERC-20 balance adapter
 *
 * Fetches the balance that `allocation.holdingWallet` holds of the token
 * referenced by `allocation.underlying` ("<blockchain>:<address>").
 *
 * The token's blockchain and address are read from the token registry
 * (src/allocationData/tokens.ts) — no string-splitting required at runtime.
 *
 * Decimals resolution order:
 *   1. Token registry `decimals` field — zero extra RPC calls.
 *   2. On-chain `decimals()` call — one extra RPC call per allocation.
 *
 * Returns the balance as a human-readable number (divided by 10^decimals).
 */

import { ethers } from "ethers";
import { getProvider } from "../utils/providers";
import type { ActiveAllocation } from "../allocationData/types";
import { tokens as tokenRegistry } from "../allocationData/tokens";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export async function fetchErc20Balance(allocation: ActiveAllocation): Promise<number> {
  const token = tokenRegistry[allocation.underlying];
  if (!token) {
    throw new Error(
      `Token "${allocation.underlying}" not found in registry. ` +
      `Add it to src/allocationData/tokens.ts before fetching its balance.`
    );
  }

  const provider = getProvider(token.blockchain);
  const contract = new ethers.Contract(token.address, ERC20_ABI, provider);

  const decimals: number =
    token.decimals != null
      ? token.decimals
      : Number(await contract.decimals());

  const raw: bigint = await contract.balanceOf(allocation.holdingWallet);

  return parseFloat(ethers.formatUnits(raw, decimals));
}
