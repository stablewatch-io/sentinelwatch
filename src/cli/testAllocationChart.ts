/**
 * CLI Script: testAllocationChart
 *
 * Simulates the full allocation tracking pipeline without DB writes:
 *   1. Fetches balances for all active allocations (like storeAllocationBalances)
 *   2. Fetches prices for all unique tokens (like storeAllocationPrices)
 *   3. Generates the latest allocation chart response (like getLatestAllocationChart)
 *   4. Writes all outputs to local files with debug logging
 *
 * Prerequisites:
 *   - Configure RPC URLs in .env file (see .env for details)
 *
 * Usage: npx ts-node src/cli/testAllocationChart.ts
 */

// CRITICAL: Load environment variables BEFORE any other imports
// that might transitively depend on process.env values
import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import allocations from "../allocationData/allocations";
import { isActiveAllocation } from "../allocationData/types";
import { fetchAllocationBalance } from "../adapters/index";
import { getPrices } from "../utils/getPrices";
import { getCustomPrices } from "../adapters/prices";
import { getCurrentUnixTimestamp, getClosestDayStartTimestamp } from "../utils/date";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000; // 30 seconds per allocation
const OUTPUT_DIR = path.join(__dirname, "../../cli-output");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(prom: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    prom,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Step 1: Fetch Allocation Balances
// ---------------------------------------------------------------------------

async function fetchAllBalances() {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 1: Fetching Allocation Balances");
  console.log("=".repeat(80) + "\n");

  const timestamp = getCurrentUnixTimestamp();
  const active = allocations.filter(isActiveAllocation);

  console.log(`Processing ${active.length} active allocation(s) at timestamp ${timestamp}`);
  console.log(`Date: ${new Date(timestamp * 1000).toISOString()}\n`);

  const balances: Record<string, { balance: string; idleBalance?: string; error?: string }> = {};
  const errors: Array<{ id: string; error: string }> = [];

  await Promise.all(
    active.map(async (allocation) => {
      try {
        const balanceResult = await withTimeout(
          fetchAllocationBalance(allocation),
          FETCH_TIMEOUT_MS,
          allocation.id
        );

        // Handle idle balance allocations
        if (typeof balanceResult === "object" && "idleBalance" in balanceResult) {
          balances[allocation.id] = { 
            balance: balanceResult.balance,
            idleBalance: balanceResult.idleBalance
          };
          console.log(`✓ [${allocation.id}] balance=${balanceResult.balance}, idleBalance=${balanceResult.idleBalance}`);
          
          // Store idle balance separately for chart calculations
          const idleId = `${allocation.id}-idle`;
          balances[idleId] = { balance: balanceResult.idleBalance };
        } else {
          balances[allocation.id] = { balance: balanceResult };
          console.log(`✓ [${allocation.id}] balance=${balanceResult}`);
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`✗ [${allocation.id}] FAILED: ${errorMsg}`);
        balances[allocation.id] = { balance: "0", error: errorMsg };
        errors.push({ id: allocation.id, error: errorMsg });
      }
    })
  );

  console.log(`\nBalance fetch complete: ${active.length - errors.length}/${active.length} succeeded`);
  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    errors.forEach(({ id, error }) => {
      console.log(`  - ${id}: ${error}`);
    });
  }

  return { timestamp, balances, errors };
}

// ---------------------------------------------------------------------------
// Step 2: Fetch Allocation Prices
// ---------------------------------------------------------------------------

async function fetchAllPrices() {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 2: Fetching Allocation Prices");
  console.log("=".repeat(80) + "\n");

  const timestamp = getCurrentUnixTimestamp();
  const active = allocations.filter(isActiveAllocation);
  
  // Collect all token IDs including idle price keys for hasIdle allocations
  const allTokenIds = active.flatMap((a) => {
    const baseIds = a.priceOverride ? [a.underlying, a.priceOverride] : [a.underlying];
    // For hasIdle allocations, we need the idle price key as well
    if (a.hasIdle) {
      const priceKey = a.priceOverride || a.underlying;
      return [...baseIds, `${priceKey}-idle`];
    }
    return baseIds;
  });
  const uniqueTokenIds = [...new Set(allTokenIds)];

  console.log(`Fetching prices for ${uniqueTokenIds.length} unique token(s) from ${active.length} active allocation(s)`);
  console.log(`Timestamp: ${timestamp}\n`);

  // ----- DefiLlama Prices -----
  console.log("Fetching prices from DefiLlama...");
  const llamaPrices = await getPrices(uniqueTokenIds);
  const llamaCount = Object.keys(llamaPrices).length;
  console.log(`DefiLlama returned ${llamaCount}/${uniqueTokenIds.length} price(s)\n`);

  // ----- Custom Adapter Prices -----
  const missingIds = uniqueTokenIds.filter((id) => llamaPrices[id] == null);
  let customPrices: Record<string, number> = {};

  if (missingIds.length > 0) {
    console.log(`Fetching ${missingIds.length} missing price(s) via custom adapters...`);
    customPrices = await getCustomPrices(missingIds, llamaPrices);
    console.log(`Custom adapters resolved ${Object.keys(customPrices).length}/${missingIds.length} price(s)\n`);
  }

  const prices = { ...llamaPrices, ...customPrices };
  const priceCount = Object.keys(prices).length;

  console.log(`Total prices resolved: ${priceCount}/${uniqueTokenIds.length}\n`);

  // ----- Log individual prices -----
  console.log("Price details:");
  const missingPrices: string[] = [];
  for (const tokenId of uniqueTokenIds.sort()) {
    const price = prices[tokenId];
    if (price !== undefined) {
      const source = llamaPrices[tokenId] !== undefined ? "DefiLlama" : "Custom";
      console.log(`  ✓ [${tokenId}] = $${price} (${source})`);
    } else {
      console.warn(`  ✗ [${tokenId}] = MISSING`);
      missingPrices.push(tokenId);
    }
  }

  if (missingPrices.length > 0) {
    console.log(`\nMissing prices (${missingPrices.length}):`);
    missingPrices.forEach((id) => console.log(`  - ${id}`));
  }

  return { timestamp, prices, missingPrices };
}

// ---------------------------------------------------------------------------
// Step 3: Generate Latest Allocation Chart
// ---------------------------------------------------------------------------

async function generateLatestChart(
  balanceData: { timestamp: number; balances: Record<string, { balance: string; error?: string }> },
  priceData: { timestamp: number; prices: Record<string, number> }
) {
  console.log("\n" + "=".repeat(80));
  console.log("STEP 3: Generating Latest Allocation Chart");
  console.log("=".repeat(80) + "\n");

  const visible = allocations.filter(isActiveAllocation);
  const daySK = getClosestDayStartTimestamp(balanceData.timestamp);

  console.log(`Processing ${visible.length} allocation(s)`);
  console.log(`Day timestamp: ${daySK} (${new Date(daySK * 1000).toISOString()})\n`);

  type Entry = {
    allocations: Record<string, { usdValue: number; idleUsdValue?: number }>;
    totals: Record<string, number>;
  };

  const entry: Entry = { allocations: {}, totals: {} };
  const details: Array<{
    id: string;
    star: string;
    balance: string;
    priceKey: string;
    price: number;
    usdValue: number;
    idleBalance?: string;
    idleUsdValue?: number;
    // Enhanced metadata for validation
    name: string;
    protocol: string;
    blockchain: string;
    type: string;
    underlying: string;
    holdingWallet?: string;
    hasIdle?: boolean;
    isLP?: boolean;
    isLending?: boolean;
    isYBS?: boolean;
  }> = [];

  for (const allocation of visible) {
    const balanceInfo = balanceData.balances[allocation.id];
    if (!balanceInfo || balanceInfo.error) {
      console.warn(`  ⊘ [${allocation.id}] Skipped: ${balanceInfo?.error || "No balance data"}`);
      continue;
    }

    const priceKey = allocation.priceOverride || allocation.underlying;
    const priceUSD = priceData.prices[priceKey] ?? 0;
    const rawBalance = Number(balanceInfo.balance);
    const usdValue = rawBalance * priceUSD;
    
    let rawIdleBalance = 0;
    let idleUsdValue = 0;

    // If this allocation has idle balances, fetch them separately
    if (allocation.hasIdle) {
      const idleId = `${allocation.id}-idle`;
      const idleBalanceInfo = balanceData.balances[idleId];
      
      if (idleBalanceInfo && !idleBalanceInfo.error) {
        const idlePriceKey = `${priceKey}-idle`;
        const idlePriceUSD = priceData.prices[idlePriceKey] ?? 0;
        rawIdleBalance = Number(idleBalanceInfo.balance);
        idleUsdValue = rawIdleBalance * idlePriceUSD;
      }
    }

    const allocationEntry: { usdValue: number; idleUsdValue?: number } = { 
      usdValue: round2(usdValue) 
    };
    if (allocation.hasIdle) {
      allocationEntry.idleUsdValue = round2(idleUsdValue);
    }
    entry.allocations[allocation.id] = allocationEntry;

    if (allocation.star) {
      entry.totals[allocation.star] = (entry.totals[allocation.star] ?? 0) + usdValue + idleUsdValue;
    }

    const detail: any = {
      id: allocation.id,
      star: allocation.star || "unknown",
      balance: String(rawBalance),
      priceKey,
      price: priceUSD,
      usdValue: round2(usdValue),
      // Enhanced metadata for validation
      name: allocation.name,
      protocol: allocation.protocol,
      blockchain: allocation.blockchain,
      type: allocation.type,
      underlying: allocation.underlying,
      holdingWallet: allocation.holdingWallet || undefined,
      hasIdle: allocation.hasIdle || undefined,
      isLP: allocation.isLP || undefined,
      isLending: allocation.isLending || undefined,
      isYBS: allocation.isYBS || undefined,
    };

    // Add idle fields if applicable
    if (allocation.hasIdle) {
      detail.idleBalance = String(rawIdleBalance);
      detail.idleUsdValue = round2(idleUsdValue);
    }

    details.push(detail);

    const status = priceUSD > 0 ? "✓" : "⚠";
    const idleInfo = allocation.hasIdle ? `, idle=$${round2(idleUsdValue)}` : "";
    console.log(`  ${status} [${allocation.id}] balance=${rawBalance.toFixed(6)}, price=$${priceUSD}, usd=$${round2(usdValue)}${idleInfo}`);
  }

  // Round totals to cents
  const roundedTotals = Object.fromEntries(
    Object.entries(entry.totals).map(([s, v]) => [s, round2(v)])
  );

  const response = {
    date: daySK,
    allocations: entry.allocations,
    totals: roundedTotals,
  };

  console.log(`\nTotals by star:`);
  Object.entries(roundedTotals).forEach(([star, total]) => {
    console.log(`  ${star}: $${total.toLocaleString()}`);
  });

  // ----- Summary of issues -----
  const zeroBalances = details.filter(d => Number(d.balance) === 0);
  const zeroPrices = details.filter(d => d.price === 0 && Number(d.balance) > 0);
  const zeroUsdValues = details.filter(d => d.usdValue === 0);

  if (zeroBalances.length > 0) {
    console.log(`\n⚠ Allocations with ZERO balance (${zeroBalances.length}):`);
    zeroBalances.forEach(d => {
      console.log(`    - ${d.id} (${d.star})`);
    });
  }

  if (zeroPrices.length > 0) {
    console.log(`\n⚠ Allocations with ZERO price but non-zero balance (${zeroPrices.length}):`);
    zeroPrices.forEach(d => {
      console.log(`    - ${d.id} (${d.star}): balance=${d.balance}, token=${d.priceKey}`);
    });
  }

  if (zeroUsdValues.length > 0) {
    console.log(`\n⚠ Allocations with ZERO USD value (${zeroUsdValues.length}):`);
    zeroUsdValues.forEach(d => {
      const reason = Number(d.balance) === 0 ? "zero balance" : d.price === 0 ? "zero price" : "both zero";
      console.log(`    - ${d.id} (${d.star}): ${reason}`);
    });
  }

  return { response, details };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n" + "█".repeat(80));
  console.log("Test Allocation Chart Pipeline");
  console.log("█".repeat(80));

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`\nCreated output directory: ${OUTPUT_DIR}`);
  }

  const startTime = Date.now();

  try {
    // Step 1: Fetch balances
    const balanceData = await fetchAllBalances();
    const balanceOutputPath = path.join(OUTPUT_DIR, "1_balances.json");
    fs.writeFileSync(balanceOutputPath, JSON.stringify(balanceData, null, 2));
    console.log(`\n→ Wrote balances to: ${balanceOutputPath}`);

    // Step 2: Fetch prices
    const priceData = await fetchAllPrices();
    const priceOutputPath = path.join(OUTPUT_DIR, "2_prices.json");
    fs.writeFileSync(priceOutputPath, JSON.stringify(priceData, null, 2));
    console.log(`\n→ Wrote prices to: ${priceOutputPath}`);

    // Step 3: Generate chart
    const { response, details } = await generateLatestChart(balanceData, priceData);
    const chartOutputPath = path.join(OUTPUT_DIR, "3_latest_allocation_chart.json");
    fs.writeFileSync(chartOutputPath, JSON.stringify(response, null, 2));
    console.log(`\n→ Wrote chart response to: ${chartOutputPath}`);

    // Write detailed breakdown
    const detailsOutputPath = path.join(OUTPUT_DIR, "4_allocation_details.json");
    fs.writeFileSync(detailsOutputPath, JSON.stringify(details, null, 2));
    console.log(`→ Wrote allocation details to: ${detailsOutputPath}`);

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n" + "█".repeat(80));
    console.log("PIPELINE COMPLETE");
    console.log("█".repeat(80));
    console.log(`Elapsed time: ${elapsed}s`);
    console.log(`\nAll outputs written to: ${OUTPUT_DIR}`);
    console.log("\nFiles created:");
    console.log(`  1. 1_balances.json - Raw balance data for all allocations`);
    console.log(`  2. 2_prices.json - USD prices for all underlying tokens`);
    console.log(`  3. 3_latest_allocation_chart.json - Final API response`);
    console.log(`  4. 4_allocation_details.json - Detailed breakdown per allocation`);
    console.log("\n" + "█".repeat(80) + "\n");

  } catch (err) {
    console.error("\n" + "█".repeat(80));
    console.error("PIPELINE FAILED");
    console.error("█".repeat(80));
    console.error(err);
    process.exit(1);
  }
}

main();
