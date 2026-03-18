/**
 * GET /allocationsenriched
 *
 * Returns enriched allocation data combining:
 * - Latest allocation chart data (balances, prices, USD values)
 * - Full config metadata for each allocation
 * - Underlying token details
 * - Daily USD value change (vs yesterday)
 *
 * Response shape:
 * {
 *   date: number,
 *   allocations: [{
 *     id: string,
 *     name: string,
 *     protocol: string,
 *     star: string,
 *     blockchain: string,
 *     type: string,
 *     balance: string,
 *     price: number,
 *     usdValue: number,
 *     usdValueChange: number,
 *     underlying: { id, name, symbol, decimals, address },
 *     // ... other config fields
 *   }],
 *   totals: { [star: string]: number }
 * }
 */

import { successResponse, wrap, IResponse } from "./utils/shared";
import { db, tokenPrices, allocationBalances } from "./utils/shared/db";
import { getLastTokenPrices, getLastAllocationBalance } from "./utils/shared/getLastRecord";
import { eq, and, desc, lt } from "drizzle-orm";
import { getClosestDayStartTimestamp, secondsInHour, secondsInDay } from "./utils/date";
import allocations from "./allocationData/allocations";
import { isActiveAllocation } from "./allocationData/types";
import { tokens } from "./allocationData/tokens";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function craftAllocationsEnrichedResponse(): Promise<any> {
  const visible = allocations.filter(isActiveAllocation);

  // ----- Load latest prices (today) -----
  const lastDailyPrice = await getLastTokenPrices("daily");
  const lastHourlyPrice = await getLastTokenPrices("hourly");

  let latestPrice = lastDailyPrice;
  if (lastDailyPrice && lastHourlyPrice) {
    if (
      lastHourlyPrice.timestamp > lastDailyPrice.timestamp &&
      lastDailyPrice.timestamp + secondsInHour * 25 > lastHourlyPrice.timestamp
    ) {
      latestPrice = lastHourlyPrice;
    }
  }

  if (!latestPrice) {
    return {
      date: null,
      allocations: [],
      totals: {},
    };
  }

  const prices = (latestPrice.prices as Record<string, number>) ?? {};

  // ----- Load yesterday's prices for change calculation -----
  const todayDayStart = getClosestDayStartTimestamp(latestPrice.timestamp);
  const yesterdayDayStart = todayDayStart - secondsInDay;

  const yesterdayPrices = await db
    .select()
    .from(tokenPrices)
    .where(
      and(
        eq(tokenPrices.granularity, "daily"),
        eq(tokenPrices.timestamp, yesterdayDayStart)
      )
    )
    .limit(1);

  const yesterdayPricesMap = yesterdayPrices.length > 0 
    ? (yesterdayPrices[0].prices as Record<string, number>) 
    : {};

  // ----- Aggregate latest balances with enriched data -----
  type EnrichedAllocation = {
    id: string;
    name: string;
    protocol: string;
    star: string;
    blockchain: string;
    type: string;
    holdingWallet?: string | null;
    isYBS?: boolean | null;
    isLending?: boolean | null;
    isLP?: boolean | null;
    isMerkle?: boolean | null;
    hasIdle?: boolean | null;
    hasRRC?: boolean | null;
    market?: string | null;
    startDate?: string | null;
    underlying: {
      id: string;
      name: string;
      symbol: string;
      address: string;
      decimals?: number | null;
      blockchain: string;
    };
    balance: string;
    price: number;
    usdValue: number;
    usdValueChange: number;
    idleBalance?: string;
    idleUsdValue?: number;
    idleUsdValueChange?: number;
  };

  const enrichedAllocations: EnrichedAllocation[] = [];
  const totals: Record<string, number> = {};
  let responseDayTimestamp: number | null = null;

  await Promise.all(
    visible.map(async (allocation) => {
      const lastDailyBalance = await getLastAllocationBalance(allocation.id, "daily");
      const lastHourlyBalance = await getLastAllocationBalance(allocation.id, "hourly");

      // Use hourly if same day and more recent
      let latestBalance = lastDailyBalance;
      if (lastDailyBalance && lastHourlyBalance) {
        if (
          lastHourlyBalance.timestamp > lastDailyBalance.timestamp &&
          lastDailyBalance.timestamp + secondsInHour * 25 > lastHourlyBalance.timestamp
        ) {
          latestBalance = lastHourlyBalance;
        }
      }

      if (!latestBalance) return;

      // Set response day timestamp from first allocation
      const daySK = getClosestDayStartTimestamp(latestBalance.timestamp);
      if (responseDayTimestamp === null) {
        responseDayTimestamp = daySK;
      }

      const priceKey = allocation.priceOverride || allocation.underlying;
      const priceUSD = prices[priceKey] ?? 0;
      const rawBalance = latestBalance.balanceData.balance != null 
        ? Number(latestBalance.balanceData.balance) 
        : 0;
      let usdValue = rawBalance * priceUSD;
      
      let rawIdleBalance = 0;
      let idleUsdValue = 0;

      // If this allocation has idle balances, fetch them separately
      if (allocation.hasIdle && latestBalance.idleAllocationId) {
        const idleId = latestBalance.idleAllocationId;
        
        const lastDailyIdleBalance = await getLastAllocationBalance(idleId, "daily");
        const lastHourlyIdleBalance = await getLastAllocationBalance(idleId, "hourly");

        let latestIdleBalance = lastDailyIdleBalance;
        if (lastDailyIdleBalance && lastHourlyIdleBalance) {
          if (
            lastHourlyIdleBalance.timestamp > lastDailyIdleBalance.timestamp &&
            lastDailyIdleBalance.timestamp + secondsInHour * 25 > lastHourlyIdleBalance.timestamp
          ) {
            latestIdleBalance = lastHourlyIdleBalance;
          }
        }

        if (latestIdleBalance) {
          const idlePriceKey = `${priceKey}-idle`;
          const idlePriceUSD = prices[idlePriceKey] ?? 0;
          rawIdleBalance =
            latestIdleBalance.balanceData.balance != null
              ? Number(latestIdleBalance.balanceData.balance)
              : 0;

          idleUsdValue = rawIdleBalance * idlePriceUSD;
        }
      }

      // If allocation is marked as idle (e.g., USDS/sUSDS POL), move all value to idleUsdValue
      if (allocation.isIdle) {
        idleUsdValue = usdValue + idleUsdValue;
        usdValue = 0;
      }

      // Calculate yesterday's USD values for change
      const yesterdayBalance = await db
        .select()
        .from(allocationBalances)
        .where(
          and(
            eq(allocationBalances.allocationId, allocation.id),
            eq(allocationBalances.granularity, "daily"),
            eq(allocationBalances.timestamp, yesterdayDayStart)
          )
        )
        .limit(1);

      let usdValueChange = 0;
      let idleUsdValueChange = 0;
      
      if (yesterdayBalance.length > 0) {
        const yesterdayPriceUSD = yesterdayPricesMap[priceKey] ?? 0;
        const yesterdayRawBalance = yesterdayBalance[0].balanceData.balance != null
          ? Number(yesterdayBalance[0].balanceData.balance)
          : 0;
        let yesterdayUsdValue = yesterdayRawBalance * yesterdayPriceUSD;

        // Calculate yesterday's idle balance change if applicable
        if (allocation.hasIdle && yesterdayBalance[0].idleAllocationId) {
          const yesterdayIdleId = yesterdayBalance[0].idleAllocationId;
          const yesterdayIdleBalance = await db
            .select()
            .from(allocationBalances)
            .where(
              and(
                eq(allocationBalances.allocationId, yesterdayIdleId),
                eq(allocationBalances.granularity, "daily"),
                eq(allocationBalances.timestamp, yesterdayDayStart)
              )
            )
            .limit(1);

          if (yesterdayIdleBalance.length > 0) {
            const idlePriceKey = `${priceKey}-idle`;
            const yesterdayIdlePriceUSD = yesterdayPricesMap[idlePriceKey] ?? 0;
            const yesterdayRawIdleBalance =
              yesterdayIdleBalance[0].balanceData.balance != null
                ? Number(yesterdayIdleBalance[0].balanceData.balance)
                : 0;

            const yesterdayIdleUsdValue = yesterdayRawIdleBalance * yesterdayIdlePriceUSD;
            idleUsdValueChange = idleUsdValue - yesterdayIdleUsdValue;
          }
        }

        // If allocation is marked as idle (e.g., USDS/sUSDS POL), move all yesterday's value to idleUsdValue as well
        if (allocation.isIdle) {
          const yesterdayIdleUsdValue = yesterdayUsdValue + (idleUsdValueChange !== 0 ? (idleUsdValue - idleUsdValueChange) : 0);
          idleUsdValueChange = idleUsdValue - yesterdayIdleUsdValue;
          yesterdayUsdValue = 0;
        }

        usdValueChange = usdValue - yesterdayUsdValue;
      }

      // Get underlying token details
      const underlyingToken = tokens[allocation.underlying];
      const [blockchain, address] = allocation.underlying.split(":");
      
      // Extract symbol from token name (e.g., "USD Coin" -> "USDC", "Syrup USDT" -> "USDT")
      const extractSymbol = (name: string) => {
        const symbolMap: Record<string, string> = {
          "USD Coin": "USDC",
          "USDS Stablecoin": "USDS",
          "Dai Stablecoin": "DAI",
          "Tether USD": "USDT",
        };
        if (symbolMap[name]) return symbolMap[name];
        // Extract last word or uppercase letters
        const lastWord = name.split(" ").pop() || "";
        return lastWord.toUpperCase();
      };

      const underlyingInfo = underlyingToken ? {
        id: underlyingToken.id,
        name: underlyingToken.name,
        symbol: extractSymbol(underlyingToken.name),
        address: underlyingToken.address,
        decimals: underlyingToken.decimals,
        blockchain: underlyingToken.blockchain,
      } : {
        id: allocation.underlying,
        name: "Unknown Token",
        symbol: address.slice(0, 6),
        address: address,
        decimals: null,
        blockchain: blockchain,
      };

      const enrichedAllocation: EnrichedAllocation = {
        id: allocation.id,
        name: allocation.name,
        protocol: allocation.protocol,
        star: allocation.star,
        blockchain: allocation.blockchain,
        type: allocation.type,
        holdingWallet: allocation.holdingWallet 
          ? `${allocation.blockchain}:${allocation.holdingWallet}` 
          : null,
        isYBS: allocation.isYBS,
        isLending: allocation.isLending,
        isLP: allocation.isLP,
        isMerkle: allocation.isMerkle,
        hasIdle: allocation.hasIdle,
        hasRRC: allocation.hasRRC,
        market: allocation.market,
        startDate: allocation.startDate,
        underlying: underlyingInfo,
        balance: String(rawBalance),
        price: priceUSD,
        usdValue: round2(usdValue),
        usdValueChange: round2(usdValueChange),
      };

      // Add idle fields if applicable
      if (allocation.hasIdle || allocation.isIdle) {
        enrichedAllocation.idleBalance = String(rawIdleBalance);
        enrichedAllocation.idleUsdValue = round2(idleUsdValue);
        enrichedAllocation.idleUsdValueChange = round2(idleUsdValueChange);
      }

      enrichedAllocations.push(enrichedAllocation);

      if (allocation.star) {
        totals[allocation.star] = (totals[allocation.star] ?? 0) + usdValue + idleUsdValue;
      }
    })
  );

  // Sort by usdValue descending
  enrichedAllocations.sort((a, b) => b.usdValue - a.usdValue);

  // Round totals to cents
  const roundedTotals = Object.fromEntries(
    Object.entries(totals).map(([s, v]) => [s, round2(v)])
  );

  return {
    date: responseDayTimestamp,
    allocations: enrichedAllocations,
    totals: roundedTotals,
  };
}

const handler = async (
  _event: AWSLambda.APIGatewayEvent
): Promise<IResponse> => {
  const response = await craftAllocationsEnrichedResponse();
  return successResponse(response, 5 * 60); // 5-min browser cache
};

export default wrap(handler);
