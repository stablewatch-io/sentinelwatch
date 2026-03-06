/**
 * Uniswap V3 Position Price Adapter
 *
 * For Uniswap V3 LP positions, the "balance" returned by the balance adapter
 * is already the total USD value of all matching positions.
 *
 * Therefore, this price adapter always returns 1.0, so that:
 * balance (USD value) × price (1.0) = USD value
 *
 * This avoids the complexity of trying to price an LP position as a "token",
 * since each position is unique and contains multiple underlying assets.
 */

export async function fetchUniswapV3PositionPrice(
  _chain: string,
  _address: string
): Promise<number> {
  return 1.0;
}



