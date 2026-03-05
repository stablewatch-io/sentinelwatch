/**
 * aaveOraclePrice — AaveOracle / Sparklend oracle price fetcher
 *
 * Fetches the current USD price of an aToken's underlying asset by querying
 * the lending protocol's native oracle — the same oracle the protocol uses
 * to value positions internally.
 *
 * Steps:
 *  1. Call UNDERLYING_ASSET_ADDRESS() on the aToken to resolve the underlying ERC-20.
 *  2. Call getAssetPrice(underlying) on the AaveOracle for the relevant market.
 *  3. Normalise by BASE_CURRENCY_UNIT (1e8 for USD-denominated oracles).
 *
 * Using the protocol-native oracle ensures valuation consistency with the
 * protocol itself, per the priority order in the pricing spec:
 *   "Protocol-Native Oracles: always use the protocol's native oracle as the
 *    primary source for lending protocol allocations."
 *
 * ref: docs/aave_v3_spec.md §Smart Contracts — AaveOracle
 * ref: docs/prices_oracles_reference.md §Oracle Types — Lending Protocol Native Oracles
 */

import { ethers } from "ethers";
import { getProvider } from "../../utils/providers";

const ATOKEN_ABI = [
  "function UNDERLYING_ASSET_ADDRESS() view returns (address)",
];

const ORACLE_ABI = [
  "function getAssetPrice(address asset) view returns (uint256)",
  "function BASE_CURRENCY_UNIT() view returns (uint256)",
];

/**
 * Returns the current USD price of the asset underlying the given aToken.
 *
 * @param chain          Canonical chain name matching keys in src/utils/rpcs.ts.
 * @param aTokenAddress  The aToken contract address (= allocation.underlying address).
 *                       UNDERLYING_ASSET_ADDRESS() is called on this contract.
 * @param oracleAddress  The AaveOracle (or Sparklend oracle) for the relevant market.
 */
export async function fetchAaveOraclePrice(
  chain: string,
  aTokenAddress: string,
  oracleAddress: string
): Promise<number> {
  const provider = getProvider(chain);
  const aToken = new ethers.Contract(aTokenAddress, ATOKEN_ABI, provider);
  const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);

  // Resolve underlying asset address and base currency unit in parallel.
  const [underlyingAddress, baseCurrencyUnit]: [string, bigint] =
    await Promise.all([
      aToken.UNDERLYING_ASSET_ADDRESS(),
      oracle.BASE_CURRENCY_UNIT(),
    ]);

  const rawPrice: bigint = await oracle.getAssetPrice(underlyingAddress);

  // baseCurrencyUnit is 1e8 for USD oracles → price in USD with 8 decimals.
  return Number(rawPrice) / Number(baseCurrencyUnit);
}

