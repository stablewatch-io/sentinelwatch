/**
 * chronicleVaoPrice — Chronicle VAO (Value Asset Oracle) price fetcher
 *
 * Chronicle has two oracle types:
 *
 *   1. Chainlink-compatible: exposes `latestAnswer()` + `decimals()` — handled by chainlinkFeedPrice.ts
 *   2. VAO (Value Asset Oracle): exposes `read() → uint256` — handled here
 *
 * VAO oracles are used for tokenised RWA assets (Centrifuge, Securitize, etc.)
 * and return the price as a WAD-scaled uint256 (18 decimal precision, 1e18 = $1.00).
 *
 * Read the price with `read()`.  If `read()` reverts (e.g. the caller is not
 * tolled / whitelisted), fall back to `tryRead()` which never reverts and
 * returns `(bool ok, uint256 val)` instead.
 */

import { ethers } from "ethers";
import { getProvider } from "../../utils/providers";

const VAO_ABI = [
  "function read() view returns (uint256 val)",
  "function tryRead() view returns (bool ok, uint256 val)",
];

/** Chronicle VAO prices are WAD-scaled (18 decimals). 1e18 = $1.00 */
const WAD = 10n ** 18n;

/**
 * Fetches the current USD price from a Chronicle VAO oracle.
 *
 * @param chain          Canonical chain name (e.g. "ethereum")
 * @param oracleAddress  Chronicle VAO contract address
 * @returns              USD price as a JS number
 */
export async function fetchChronicleVaoPrice(
  chain: string,
  oracleAddress: string
): Promise<number> {
  const provider = getProvider(chain);
  const oracle = new ethers.Contract(oracleAddress, VAO_ABI, provider);

  // Prefer `read()` — it reverts if the contract is paused or stale.
  // Fall back to `tryRead()` if `read()` is access-controlled.
  let val: bigint;
  try {
    val = await oracle.read();
  } catch {
    const [ok, fallbackVal]: [boolean, bigint] = await oracle.tryRead();
    if (!ok) {
      throw new Error(
        `Chronicle VAO oracle at ${oracleAddress} returned ok=false from tryRead(). ` +
          `The price may be stale or the oracle paused.`
      );
    }
    val = fallbackVal;
  }

  return Number(val) / Number(WAD);
}


