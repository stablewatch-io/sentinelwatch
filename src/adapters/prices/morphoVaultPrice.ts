/**
 * morphoVaultPrice — MetaMorpho vault token pricer (V1 & V2)
 *
 * Prices MetaMorpho vault tokens by querying the vault's share price and
 * multiplying by the underlying asset's USD price.
 *
 * MetaMorpho vaults are ERC-4626 compliant — vault tokens are shares that
 * appreciate as yield accrues. Both V1 and V2 use the same interface.
 *
 * Steps:
 *  1. Call convertToAssets(10^18) to get the current share price (assets per share, WAD-scaled)
 *  2. Call asset() to discover the underlying token address
 *  3. Look up the underlying token's USD price (from the prices map passed in)
 *  4. Calculate: vaultTokenPrice = (sharePrice / 10^18) × underlyingPrice
 *
 * Why convertToAssets instead of totalAssets / totalSupply:
 *   The spec warns that totalAssets() is dynamic and queries Morpho Blue markets
 *   live, causing it to "run ahead" of totalSupply between fee accruals. This
 *   creates false dips in the share price at fee-share mints. convertToAssets(10^18)
 *   handles consistency and virtual offsets correctly.
 *
 * ref: docs/morpho_spec.md §Share-Based Accounting (ERC-4626)
 * ref: docs/morpho_spec.md §APY Calculation from Events (Method 1 warning)
 */

import { ethers } from "ethers";
import { getProvider } from "../../utils/providers";
import { getPrices } from "../../utils/getPrices";
import type { PriceMap } from "./index";
import { tokens as tokenRegistry } from "../../allocationData/tokens";

const VAULT_ABI = [
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function asset() view returns (address)",
];

const ERC20_ABI = ["function decimals() view returns (uint8)"];

const WAD = BigInt(10) ** BigInt(18);

/**
 * Returns the current USD price of a MetaMorpho vault token.
 *
 * @param chain          Canonical chain name matching keys in src/utils/rpcs.ts.
 * @param vaultAddress   The MetaMorpho vault contract address.
 * @param prices         Price map containing underlying token prices (from DefiLlama + custom adapters).
 *                       The underlying asset price must already be in this map.
 */
export async function fetchMorphoVaultPrice(
  chain: string,
  vaultAddress: string,
  prices: PriceMap
): Promise<number> {
  const provider = getProvider(chain);
  const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);

  // Query vault for underlying asset address and share price in parallel
  const [underlyingAddress, sharePrice]: [string, bigint] = await Promise.all([
    vault.asset(),
    vault.convertToAssets(WAD), // returns assets-per-share in the underlying's raw units
  ]);

  // Fetch the underlying token's decimals so we can normalise correctly.
  // convertToAssets(WAD) returns a value denominated in the underlying token's
  // own decimal precision — NOT in WAD (18) — so we must divide by 10^underlyingDecimals.
  // Example: USDC vault → underlyingDecimals=6, sharePrice≈1_005_000 → 1.005
  //          AUSD vault → underlyingDecimals=18, sharePrice≈1.005e18   → 1.005
  const underlyingContract = new ethers.Contract(underlyingAddress, ERC20_ABI, provider);
  const underlyingDecimals: number = Number(await underlyingContract.decimals());

  // Build the token ID for price lookup: "chain:address"
  const underlyingTokenId = `${chain}:${underlyingAddress.toLowerCase()}`;

  let underlyingPrice = prices[underlyingTokenId];
  if (underlyingPrice == null) {
    const fetched = await getPrices([underlyingTokenId]);
    underlyingPrice = fetched[underlyingTokenId];
  }

  if (underlyingPrice == null) {
    throw new Error(
      `Underlying token price not found for Morpho vault ${vaultAddress}. ` +
        `Underlying token: ${underlyingTokenId}. ` +
        `DefiLlama does not recognise this token — add a custom price adapter for it.`
    );
  }

  // vault token price = (sharePrice / 10^underlyingDecimals) × underlyingPrice
  const shareMultiplier = Number(sharePrice) / 10 ** underlyingDecimals;
  return shareMultiplier * underlyingPrice;
}

