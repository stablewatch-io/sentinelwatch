/**
 * getCustomPrices — fallback price fetcher for tokens not on DefiLlama
 *
 * Accepts a list of token IDs, checks each against the priceAdapters registry,
 * and fetches prices for any that have a registered adapter.
 * Tokens without a registered adapter are silently skipped.
 */

import { fetchChainlinkFeedPrice } from "./chainlinkFeedPrice";
import { fetchErc4626Price } from "./erc4626Price";
import { fetchAaveOraclePrice } from "./aaveOraclePrice";
import { fetchMorphoVaultPrice } from "./morphoVaultPrice";
import { fetchUniswapV3PositionPrice } from "./uniswapV3PositionPrice";
import { priceAdapters } from "./priceAdapters";

/** Maps "<blockchain>:<address>" → USD price */
export type PriceMap = Record<string, number>;

/**
 * @param tokenIds  Array of "<blockchain>:<address>" strings.
 *                  Only IDs with a registered adapter in priceAdapters.ts will
 *                  produce a result; all others are silently ignored.
 * @param prices    Optional pre-existing price map (e.g., from DefiLlama).
 *                  Morpho vault adapters will use this to look up underlying token prices.
 * @returns         Partial PriceMap — only contains entries for IDs that were
 *                  successfully priced.
 */
export async function getCustomPrices(
  tokenIds: string[],
  prices: PriceMap = {}
): Promise<PriceMap> {
  const result: PriceMap = { ...prices }; // Start with existing prices

  // Pass 1: Process all non-morphoVault adapters (no dependencies)
  await Promise.all(
    tokenIds.map(async (id) => {
      const adapter = priceAdapters[id];
      if (!adapter || adapter.type === "morphoVault") return;

      console.log(`getCustomPrices [${id}]: fetching price using ${adapter.type}`);
      try {
        if (adapter.type === "chainlinkFeed") {
          result[id] = await fetchChainlinkFeedPrice(
            adapter.chain,
            adapter.oracleAddress
          );
        } else if (adapter.type === "erc4626") {
          result[id] = await fetchErc4626Price(
            adapter.chain,
            adapter.vaultAddress,
            adapter.underlyingPriceUsd
          );
        } else if (adapter.type === "aaveOracle") {
          result[id] = await fetchAaveOraclePrice(
            adapter.chain,
            adapter.aTokenAddress,
            adapter.oracleAddress
          );
        } else if (adapter.type === "hardcoded") {
          result[id] = adapter.price;
        } else if (adapter.type === "uniswapV3Position") {
          result[id] = 1.0;  // Balance adapter returns USD value directly
        }
        console.log(`getCustomPrices [${id}]: price=${result[id]}`);
      } catch (err) {
        console.error(`getCustomPrices [${id}]: ${adapter.type} failed:`, err);
      }
    })
  );

  // Pass 2: Process morphoVault adapters (depend on underlying token prices)
  await Promise.all(
    tokenIds.map(async (id) => {
      const adapter = priceAdapters[id];
      if (!adapter || adapter.type !== "morphoVault") return;

      console.log(`getCustomPrices [${id}]: fetching price using ${adapter.type}`);
      try {
        result[id] = await fetchMorphoVaultPrice(
          adapter.chain,
          adapter.vaultAddress,
          result // Pass the accumulated price map
        );
        console.log(`getCustomPrices [${id}]: price=${result[id]}`);
      } catch (err) {
        console.error(`getCustomPrices [${id}]: ${adapter.type} failed:`, err);
      }
    })
  );

  return result;
}

