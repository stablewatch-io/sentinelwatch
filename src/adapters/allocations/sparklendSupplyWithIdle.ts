/**
 * Sparklend Supply Balance Adapter (with Idle)
 *
 * For Sparklend lending positions (spDAI, spUSDS):
 * - Active balance: User's spToken balance (represents actively earning assets)
 * - Idle balance: User's proportional share of the pool's available liquidity
 * 
 * Methodology:
 * 1. Fetch user's spToken balance
 * 2. Query Spark UI Pool Data Provider for reserve data
 * 3. Find the reserve matching the spToken address
 * 4. Calculate idle = (availableLiquidity × userBalance) / totalSupply
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

const UI_POOL_DATA_PROVIDER_ABI = [
  `function getReservesData(address provider) external view returns (
    tuple(
      address underlyingAsset,
      string name,
      string symbol,
      uint256 decimals,
      uint256 baseLTVasCollateral,
      uint256 reserveLiquidationThreshold,
      uint256 reserveLiquidationBonus,
      uint256 reserveFactor,
      bool usageAsCollateralEnabled,
      bool borrowingEnabled,
      bool stableBorrowRateEnabled,
      bool isActive,
      bool isFrozen,
      uint128 liquidityIndex,
      uint128 variableBorrowIndex,
      uint128 liquidityRate,
      uint128 variableBorrowRate,
      uint128 stableBorrowRate,
      uint40 lastUpdateTimestamp,
      address aTokenAddress,
      address stableDebtTokenAddress,
      address variableDebtTokenAddress,
      address interestRateStrategyAddress,
      uint256 availableLiquidity,
      uint256 totalPrincipalStableDebt,
      uint256 averageStableRate,
      uint256 stableDebtLastUpdateTimestamp,
      uint256 totalScaledVariableDebt,
      uint256 priceInMarketReferenceCurrency,
      address priceOracle,
      uint256 variableRateSlope1,
      uint256 variableRateSlope2,
      uint256 stableRateSlope1,
      uint256 stableRateSlope2,
      uint256 baseStableBorrowRate,
      uint256 baseVariableBorrowRate,
      uint256 optimalUsageRatio,
      bool isPaused,
      bool isSiloedBorrowing,
      uint128 accruedToTreasury,
      uint128 unbacked,
      uint128 isolationModeTotalDebt,
      bool flashLoanEnabled,
      uint256 debtCeiling,
      uint256 debtCeilingDecimals,
      uint8 eModeCategoryId,
      uint256 borrowCap,
      uint256 supplyCap,
      uint16 eModeLtv,
      uint16 eModeLiquidationThreshold,
      uint16 eModeLiquidationBonus,
      address eModePriceSource,
      string eModeLabel,
      bool borrowableInIsolation
    )[] reserves,
    tuple(
      uint256 marketReferenceCurrencyUnit,
      int256 marketReferenceCurrencyPriceInUsd,
      int256 networkBaseTokenPriceInUsd,
      uint8 networkBaseTokenPriceDecimals
    ) baseCurrencyInfo
  )`
];

const UI_POOL_DATA_PROVIDER = "0xF028c2F4b19898718fD0F77b9b881CbfdAa5e8Bb";
const SPARK_POOL_ADDRESSES_PROVIDER = "0x02C3eA4e34C0cBd694D2adFa2c690EECbC1793eE";

export async function fetchBalance(
  allocation: ActiveAllocation
): Promise<{ balance: string; idleBalance: string }> {
  if (!allocation.holdingWallet) {
    throw new Error(`sparklendSupplyWithIdle adapter requires holdingWallet for allocation ${allocation.id}`);
  }

  const spToken = tokenRegistry[allocation.underlying];
  if (!spToken) {
    throw new Error(`Token "${allocation.underlying}" not found in registry`);
  }

  const provider = getProvider(spToken.blockchain);
  const spTokenContract = new ethers.Contract(spToken.address, ERC20_ABI, provider);

  // Fetch user's spToken balance (active balance)
  const userBalanceRaw = await spTokenContract.balanceOf(allocation.holdingWallet);
  const decimals = spToken.decimals != null ? spToken.decimals : await spTokenContract.decimals();
  const balance = ethers.formatUnits(userBalanceRaw, decimals);

  console.log(`[${allocation.id}] User spToken balance: ${balance}`);

  // Fetch total supply of spToken
  const totalSupplyRaw = await spTokenContract.totalSupply();
  const totalSupply = ethers.formatUnits(totalSupplyRaw, decimals);
  
  console.log(`[${allocation.id}] spToken total supply: ${totalSupply}`);

  // If user has no balance, return zeros
  if (userBalanceRaw === BigInt(0)) {
    return { balance: "0", idleBalance: "0" };
  }

  // Query Spark UI Pool Data Provider for reserve data
  const uiDataProvider = new ethers.Contract(
    UI_POOL_DATA_PROVIDER,
    UI_POOL_DATA_PROVIDER_ABI,
    provider
  );

  const [reserves] = await uiDataProvider.getReservesData(SPARK_POOL_ADDRESSES_PROVIDER);

  console.log(`[${allocation.id}] Fetched ${reserves.length} reserves from Spark`);

  // Find the reserve matching our spToken address
  const matchingReserve = reserves.find(
    (reserve: any) => reserve.aTokenAddress.toLowerCase() === spToken.address.toLowerCase()
  );

  if (!matchingReserve) {
    console.warn(
      `[${allocation.id}] No matching reserve found for aToken ${spToken.address}. ` +
      `Available aTokens: ${reserves.map((r: any) => r.aTokenAddress).join(", ")}`
    );
    return { balance, idleBalance: "0" };
  }

  console.log(`[${allocation.id}] Found reserve: ${matchingReserve.symbol}`);
  console.log(`[${allocation.id}] Available liquidity (raw): ${matchingReserve.availableLiquidity.toString()}`);

  // Calculate user's share of available liquidity
  // idleBalance = (availableLiquidity × userBalance) / totalSupply
  const availableLiquidityScaled = (matchingReserve.availableLiquidity * userBalanceRaw) / totalSupplyRaw;
  const idleBalance = ethers.formatUnits(availableLiquidityScaled, decimals);

  // Active balance = total balance - idle balance
  const activeBalance = (userBalanceRaw - availableLiquidityScaled);
  const activeBalanceFormatted = ethers.formatUnits(activeBalance, decimals);

  const availableLiquidityFormatted = ethers.formatUnits(matchingReserve.availableLiquidity, decimals);
  console.log(`[${allocation.id}] Pool available liquidity: ${availableLiquidityFormatted}`);
  console.log(`[${allocation.id}] User share: ${(Number(balance) / Number(totalSupply) * 100).toFixed(4)}%`);
  console.log(`[${allocation.id}] Total balance: ${balance}`);
  console.log(`[${allocation.id}] Active balance (after subtracting idle): ${activeBalanceFormatted}`);
  console.log(`[${allocation.id}] Idle balance: ${idleBalance}`);

  return { balance: activeBalanceFormatted, idleBalance };
}
