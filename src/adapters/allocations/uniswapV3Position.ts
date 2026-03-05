/**
 * Uniswap V3 Position Balance Adapter
 *
 * Fetches the total USD value of all Uniswap V3 LP positions owned by the
 * holding wallet that match the specified pool (token0, token1, feeTier).
 *
 * Unlike regular ERC-20 tokens, Uniswap V3 positions are NFTs. Each position
 * can have different price ranges and liquidity amounts. This adapter:
 *   1. Queries the NonfungiblePositionManager for all NFTs owned by the wallet
 *   2. Filters to positions matching the target pool
 *   3. Calculates token amounts in each position (including unclaimed fees)
 *   4. Sums the USD value across all positions
 *
 * Returns the total USD value as a string. The corresponding price adapter
 * should return 1.0, so balance × price = USD value.
 */

import { ethers } from "ethers";
import type { ActiveAllocation } from "../../allocationData/types";
import { getProvider } from "../../utils/providers";
import { tokens as tokenRegistry } from "../../allocationData/tokens";

const NFT_POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

const POOL_ABI = [
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
];

const ERC20_ABI = ["function decimals() external view returns (uint8)"];

// NonfungiblePositionManager addresses by chain
const NFT_POSITION_MANAGER_ADDRESSES: Record<string, string> = {
  ethereum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  base: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
  arbitrum: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  optimism: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  polygon: "0xC36442b4a4522E871399CD717aBDD847Ab11FE88",
  avalanche: "0x655C406EBFa14EE2006250925e54ec43AD184f8B",
};

/**
 * Calculates token amounts in a position given liquidity and tick range.
 * Based on Uniswap V3 math: https://uniswap.org/whitepaper-v3.pdf
 */
function calculatePositionAmounts(
  liquidity: bigint,
  currentTick: number,
  tickLower: number,
  tickUpper: number
): { amount0: bigint; amount1: bigint } {
  // If no liquidity, return zero
  if (liquidity === 0n) {
    return { amount0: 0n, amount1: 0n };
  }

  // Convert ticks to sqrt prices (Q64.96 format)
  const sqrtPriceLower = tickToSqrtPriceX96(tickLower);
  const sqrtPriceUpper = tickToSqrtPriceX96(tickUpper);
  const sqrtPriceCurrent = tickToSqrtPriceX96(currentTick);

  let amount0 = 0n;
  let amount1 = 0n;

  // Position is out of range (price below range)
  if (currentTick < tickLower) {
    // Position is 100% token0
    amount0 = getAmount0ForLiquidity(sqrtPriceLower, sqrtPriceUpper, liquidity);
  }
  // Position is out of range (price above range)
  else if (currentTick >= tickUpper) {
    // Position is 100% token1
    amount1 = getAmount1ForLiquidity(sqrtPriceLower, sqrtPriceUpper, liquidity);
  }
  // Position is in range
  else {
    amount0 = getAmount0ForLiquidity(sqrtPriceCurrent, sqrtPriceUpper, liquidity);
    amount1 = getAmount1ForLiquidity(sqrtPriceLower, sqrtPriceCurrent, liquidity);
  }

  return { amount0, amount1 };
}

/**
 * Convert tick to sqrtPriceX96: sqrt(1.0001^tick) * 2^96
 */
function tickToSqrtPriceX96(tick: number): bigint {
  const Q96 = 2n ** 96n;
  // For simplicity, use approximate calculation
  // price = 1.0001^tick
  // sqrtPrice = sqrt(price)
  // sqrtPriceX96 = sqrtPrice * 2^96
  
  const absTick = Math.abs(tick);
  let ratio = 1.0001 ** absTick;
  
  if (tick < 0) {
    ratio = 1 / ratio;
  }
  
  const sqrtPrice = Math.sqrt(ratio);
  return BigInt(Math.floor(sqrtPrice * Number(Q96)));
}

/**
 * Calculate amount0 from liquidity and price range
 */
function getAmount0ForLiquidity(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];
  }
  
  const Q96 = 2n ** 96n;
  const numerator = liquidity * Q96 * (sqrtPriceBX96 - sqrtPriceAX96);
  const denominator = sqrtPriceBX96 * sqrtPriceAX96;
  
  return numerator / denominator;
}

/**
 * Calculate amount1 from liquidity and price range
 */
function getAmount1ForLiquidity(
  sqrtPriceAX96: bigint,
  sqrtPriceBX96: bigint,
  liquidity: bigint
): bigint {
  if (sqrtPriceAX96 > sqrtPriceBX96) {
    [sqrtPriceAX96, sqrtPriceBX96] = [sqrtPriceBX96, sqrtPriceAX96];
  }
  
  const Q96 = 2n ** 96n;
  return (liquidity * (sqrtPriceBX96 - sqrtPriceAX96)) / Q96;
}

export async function fetchBalance(allocation: ActiveAllocation): Promise<string> {
  // Validate required fields
  if (!allocation.holdingWallet) {
    throw new Error(
      `Uniswap V3 adapter requires holdingWallet for allocation ${allocation.id}`
    );
  }
  if (!allocation.poolAddress) {
    throw new Error(
      `Uniswap V3 adapter requires poolAddress for allocation ${allocation.id}`
    );
  }
  if (!allocation.token0 || !allocation.token1) {
    throw new Error(
      `Uniswap V3 adapter requires token0 and token1 for allocation ${allocation.id}`
    );
  }
  if (!allocation.feeTier) {
    throw new Error(
      `Uniswap V3 adapter requires feeTier for allocation ${allocation.id}`
    );
  }

  const token = tokenRegistry[allocation.underlying];
  if (!token) {
    throw new Error(
      `Token "${allocation.underlying}" not found in registry for allocation ${allocation.id}`
    );
  }

  const chain = token.blockchain;
  const nftManagerAddress = NFT_POSITION_MANAGER_ADDRESSES[chain];
  if (!nftManagerAddress) {
    throw new Error(
      `Uniswap V3 NonfungiblePositionManager not configured for chain ${chain}`
    );
  }

  const provider = getProvider(chain);
  const nftManager = new ethers.Contract(nftManagerAddress, NFT_POSITION_MANAGER_ABI, provider);
  const pool = new ethers.Contract(allocation.poolAddress, POOL_ABI, provider);

  // Get current pool state
  const slot0 = await pool.slot0();
  const currentTick = Number(slot0.tick);

  // Get all NFT positions owned by the wallet
  const balance = await nftManager.balanceOf(allocation.holdingWallet);
  const numPositions = Number(balance);

  if (numPositions === 0) {
    return "0";
  }

  // Fetch token metadata
  const token0Meta = tokenRegistry[allocation.token0];
  const token1Meta = tokenRegistry[allocation.token1];
  if (!token0Meta || !token1Meta) {
    throw new Error(
      `Token metadata not found: ${allocation.token0} or ${allocation.token1}`
    );
  }

  // Resolve decimals
  const token0Contract = new ethers.Contract(token0Meta.address, ERC20_ABI, provider);
  const token1Contract = new ethers.Contract(token1Meta.address, ERC20_ABI, provider);
  const [decimals0, decimals1] = await Promise.all([
    token0Meta.decimals != null ? Promise.resolve(token0Meta.decimals) : token0Contract.decimals(),
    token1Meta.decimals != null ? Promise.resolve(token1Meta.decimals) : token1Contract.decimals(),
  ]);

  // Fetch prices from DefiLlama (this is a simplified approach - in production
  // you'd want to pass prices in or fetch from the pricing pipeline)
  const { default: getTokenPrices } = await import("../../utils/fetchTokenPrices");
  const prices = await getTokenPrices([allocation.token0, allocation.token1]);
  const price0 = prices[allocation.token0] ?? 0;
  const price1 = prices[allocation.token1] ?? 0;

  let totalValue = 0;

  // Process each position
  for (let i = 0; i < numPositions; i++) {
    const tokenId = await nftManager.tokenOfOwnerByIndex(allocation.holdingWallet, i);
    const position = await nftManager.positions(tokenId);

    // Filter: only include positions matching our target pool
    if (
      position.token0.toLowerCase() !== token0Meta.address.toLowerCase() ||
      position.token1.toLowerCase() !== token1Meta.address.toLowerCase() ||
      Number(position.fee) !== allocation.feeTier
    ) {
      continue;
    }

    // Calculate token amounts in this position
    const { amount0, amount1 } = calculatePositionAmounts(
      position.liquidity,
      currentTick,
      Number(position.tickLower),
      Number(position.tickUpper)
    );

    // Add unclaimed fees
    const totalAmount0 = amount0 + position.tokensOwed0;
    const totalAmount1 = amount1 + position.tokensOwed1;

    // Convert to decimal
    const amount0Decimal = Number(totalAmount0) / 10 ** Number(decimals0);
    const amount1Decimal = Number(totalAmount1) / 10 ** Number(decimals1);

    // Calculate USD value
    const value0 = amount0Decimal * price0;
    const value1 = amount1Decimal * price1;

    totalValue += value0 + value1;
  }

  // Return total USD value as a string
  return totalValue.toString();
}

