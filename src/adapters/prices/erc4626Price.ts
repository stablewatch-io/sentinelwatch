/**
 * erc4626Price — ERC4626 vault NAV-per-share pricer
 *
 * Prices a vault share token by computing:
 *   navPerShare = totalAssets() / totalSupply()   (both normalised to their decimals)
 *   usdPrice    = navPerShare × underlyingPriceUsd
 *
 * This is classified as a "supplementary" source in the pricing spec — not a
 * market price and can be manipulated (e.g. by pausing redemptions). Use only
 * when no oracle alternative is available.
 *
 * ref: prices_oracles_reference.md §Oracle Types — "ERC4626 totalAssets"
 */

import { ethers } from "ethers";
import { getProvider } from "../../utils/providers";

const ERC4626_ABI = [
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function asset() view returns (address)",
];

const ERC20_DECIMALS_ABI = ["function decimals() view returns (uint8)"];

/**
 * Returns the USD price of one vault share.
 *
 * @param chain               Canonical chain name (e.g. "ethereum")
 * @param vaultAddress        ERC4626 vault contract address (= the token address)
 * @param underlyingPriceUsd  USD price of 1 unit of the vault's underlying token.
 *                            Defaults to 1 — correct for USD stablecoin vaults.
 */
export async function fetchErc4626Price(
  chain: string,
  vaultAddress: string,
  underlyingPriceUsd: number = 1
): Promise<number> {
  const provider = getProvider(chain);
  const vault = new ethers.Contract(vaultAddress, ERC4626_ABI, provider);

  // Fetch vault state and underlying address in parallel
  const [totalAssets, totalSupply, shareDecimals, underlyingAddress]: [
    bigint,
    bigint,
    number,
    string,
  ] = await Promise.all([
    vault.totalAssets(),
    vault.totalSupply(),
    vault.decimals(),
    vault.asset(),
  ]);

  if (totalSupply === 0n) return 0;

  // Resolve underlying decimals
  const underlyingContract = new ethers.Contract(
    underlyingAddress,
    ERC20_DECIMALS_ABI,
    provider
  );
  const underlyingDecimals: number = await underlyingContract.decimals();

  const assetsNormalized = Number(totalAssets) / 10 ** underlyingDecimals;
  const supplyNormalized = Number(totalSupply) / 10 ** shareDecimals;

  return (assetsNormalized / supplyNormalized) * underlyingPriceUsd;
}

