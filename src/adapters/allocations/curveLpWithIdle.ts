/**
 * Curve LP Balance Adapter (with Idle)
 *
 * Generic adapter for Curve LP positions that separate active and idle balances.
 * 
 * For Curve LP tokens with hasIdle=true:
 * 1. Fetches the user's LP token balance
 * 2. Gets the pool's composition using get_balances()
 * 3. Calculates the user's share of each underlying token
 * 4. Returns allocated token balance and idle token balance separately
 * 
 * Requires token config to have allocatedAddress and idleAddress fields.
 */

import { ethers } from "ethers";
import type { ActiveAllocation } from "../../allocationData/types";
import { getProvider } from "../../utils/providers";
import { tokens as tokenRegistry } from "../../allocationData/tokens";

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function totalSupply() external view returns (uint256)",
];

const CURVE_POOL_ABI = [
  "function N_COINS() external view returns (uint256)",
  "function coins(uint256 i) external view returns (address)",
  "function balances(uint256 i) external view returns (uint256)",
  "function get_balances() external view returns (uint256[])",
];

export async function fetchBalance(
  allocation: ActiveAllocation
): Promise<{ balance: string; idleBalance: string }> {
  if (!allocation.holdingWallet) {
    throw new Error(`curveLpWithIdle adapter requires holdingWallet for allocation ${allocation.id}`);
  }

  const lpToken = tokenRegistry[allocation.underlying];
  if (!lpToken) {
    throw new Error(`Token "${allocation.underlying}" not found in registry`);
  }

  if (!lpToken.allocatedAddress || !lpToken.idleAddress) {
    throw new Error(
      `Token "${allocation.underlying}" must have allocatedAddress and idleAddress ` +
      `configured for curveLpWithIdle adapter`
    );
  }

  const allocatedToken = tokenRegistry[lpToken.allocatedAddress];
  const idleToken = tokenRegistry[lpToken.idleAddress];

  if (!allocatedToken || !idleToken) {
    throw new Error(
      `Allocated or idle token not found in registry. ` +
      `allocatedAddress: ${lpToken.allocatedAddress}, idleAddress: ${lpToken.idleAddress}`
    );
  }

  const provider = getProvider(lpToken.blockchain);

  // Get user's LP token balance
  const lpContract = new ethers.Contract(lpToken.address, ERC20_ABI, provider);
  const userLpBalance = await lpContract.balanceOf(allocation.holdingWallet);
  const totalSupply = await lpContract.totalSupply();

  if (userLpBalance === BigInt(0)) {
    return { balance: "0", idleBalance: "0" };
  }

  // Get pool contract (LP token is also the pool contract for Curve)
  const poolContract = new ethers.Contract(lpToken.address, CURVE_POOL_ABI, provider);

  // Get number of coins and their addresses
  const nCoins = await poolContract.N_COINS();
  const coinAddresses: string[] = [];
  
  for (let i = 0; i < Number(nCoins); i++) {
    coinAddresses.push(await poolContract.coins(i));
  }

  // Normalize addresses for comparison
  const normalizeAddress = (addr: string) => addr.toLowerCase();
  const allocatedIdx = coinAddresses.findIndex(
    addr => normalizeAddress(addr) === normalizeAddress(allocatedToken.address)
  );
  const idleIdx = coinAddresses.findIndex(
    addr => normalizeAddress(addr) === normalizeAddress(idleToken.address)
  );

  if (allocatedIdx === -1 || idleIdx === -1) {
    throw new Error(
      `Pool coins do not match expected tokens. ` +
      `Pool coins: ${coinAddresses.join(", ")}, ` +
      `Expected allocated: ${allocatedToken.address}, idle: ${idleToken.address}`
    );
  }

  // Get pool balances for allocated and idle tokens
  const allocatedPoolBalance = await poolContract.balances(allocatedIdx);
  const idlePoolBalance = await poolContract.balances(idleIdx);

  // Calculate user's share of each token
  // userShare = (userLpBalance / totalSupply) × poolBalance
  const allocatedTokenContract = new ethers.Contract(
    allocatedToken.address,
    ERC20_ABI,
    provider
  );
  const idleTokenContract = new ethers.Contract(
    idleToken.address,
    ERC20_ABI,
    provider
  );

  const allocatedDecimals = allocatedToken.decimals != null 
    ? allocatedToken.decimals 
    : await allocatedTokenContract.decimals();
  const idleDecimals = idleToken.decimals != null 
    ? idleToken.decimals 
    : await idleTokenContract.decimals();

  // Calculate user's underlying token amounts
  // balance = (userLpBalance × poolBalance) / totalSupply
  const userAllocatedAmount = (userLpBalance * allocatedPoolBalance) / totalSupply;
  const userIdleAmount = (userLpBalance * idlePoolBalance) / totalSupply;

  const balance = ethers.formatUnits(userAllocatedAmount, allocatedDecimals);
  const idleBalance = ethers.formatUnits(userIdleAmount, idleDecimals);

  return { balance, idleBalance };
}
