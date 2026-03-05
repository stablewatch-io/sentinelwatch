/**
 * chainlinkFeedPrice — generic Chainlink-compatible push oracle fetcher
 *
 * Works with any oracle that implements the standard Chainlink ABI:
 *   - Chronicle push oracles
 *   - Redstone push oracles
 *   - Standard Chainlink price feeds
 *
 * All three oracle types expose `latestAnswer()` and `decimals()`.
 */

import { ethers } from "ethers";
import { getProvider } from "../../utils/providers";

const FEED_ABI = [
  "function latestAnswer() view returns (int256)",
  "function decimals() view returns (uint8)",
];

/**
 * Fetches the current USD price from a Chainlink-compatible push oracle.
 *
 * @param chain          Canonical chain name (e.g. "ethereum", "avalanche")
 * @param oracleAddress  On-chain oracle contract address
 * @returns              USD price as a JS number
 */
export async function fetchChainlinkFeedPrice(
  chain: string,
  oracleAddress: string
): Promise<number> {
  const provider = getProvider(chain);
  const feed = new ethers.Contract(oracleAddress, FEED_ABI, provider);

  const [rawAnswer, decimals]: [bigint, number] = await Promise.all([
    feed.latestAnswer(),
    feed.decimals(),
  ]);

  return Number(rawAnswer) / 10 ** decimals;
}

