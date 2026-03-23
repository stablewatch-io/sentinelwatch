/**
 * CLI Script: testAllocationChart
 *
 * Simulates the full allocation tracking pipeline without DB writes:
 *   1. Fetches balances for all active allocations (like storeAllocationBalances)
 *   2. Fetches prices for all unique tokens (like storeAllocationPrices)
 *   3. Generates the latest allocation chart response (like getLatestAllocationChart)
 *   4. Fetches live data from Block Analytica and validates the chart output against it
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

const FETCH_TIMEOUT_MS = 30_000;
const OUTPUT_DIR = path.join(__dirname, "../../cli-output");
const DISCREPANCY_THRESHOLD_PERCENT = 5;
const BLOCK_ANALYTICA_URL = "https://observatory.data.blockanalitica.com/allocations/?limit=200";

// ---------------------------------------------------------------------------
// Validation: backend address overrides
//
// Some backend entries track a wrapper/contract address rather than the
// underlying token address that our config uses.  Map them here so the
// validator can still match them to the correct allocation ID.
//
// Key format:  "<token_address>:<wallet_address>:<network>"  (all lowercase)
// ---------------------------------------------------------------------------

const BACKEND_ADDRESS_OVERRIDES: Record<string, string> = {
  // PSM3 Contracts
  "0x7b42ed932f26509465f7ce3faf76ffce1275312f:0x345e368fccd62266b3f5f37c9a131fd1c39f5869:unichain":
    "spark-unichain-psm3-usdc-unichain",
  "0x1601843c5e9bc251a3272907010afa41fa18347e:0x2917956eff0b5eaf030abdb4ef4296df775009ca:base":
    "spark-base-psm3-usdc-base",
  "0x2b05f8e1cacc6974fd79a673a341fe1f58d27266:0x92afd6f2385a90e44da3a8b60fe36f6cbe1d8709:arbitrum":
    "spark-arbitrum-psm3-usdc-arbitrum",
  "0xe0f9978b907853f354d79188a3defbd41978af62:0x876664f0c9ff24d1aa355ce9f1680ae1a5bf36fb:optimism":
    "spark-optimism-psm3-usdc-optimism",
  // Anchorage
  "0x49506c3aa028693458d6ee816b2ec28522946872:0x1601843c5e9bc251a3272907010afa41fa18347e:ethereum":
    "spark-anchorage-ethereum",
  // Uniswap V3 LP
  "0xbafead7c60ea473758ed6c6021505e8bbd7e8e5d:0x491edfb0b8b608044e227225c715981a30f3a44e:ethereum":
    "grove-uniswap-lp-ausd-usdc-ethereum",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AllocationDetail = {
  id: string;
  star: string;
  balance: string;
  priceKey: string;
  price: number;
  usdValue: number;
  idleBalance?: string;
  idleUsdValue?: number;
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
};

type BackendEntry = {
  address: string;
  wallet_address: string;
  assets: string;
  allocated_assets: string;
  idle_assets: string;
  network: string;
  type: string;
  protocol: string;
  star: string;
  token_name: string;
  token_symbol: string;
  underlying_address: string | null;
  underlying_symbol: string | null;
  allocation_type: string;
};

type ValidationResult = {
  status: "matched" | "missing_in_chart" | "value_mismatch";
  allocation_id?: string;
  response_entry: {
    address: string;
    wallet_address: string;
    network: string;
    token_symbol: string;
    star: string;
    allocated_assets: number;
  };
  chart_entry?: {
    id: string;
    usdValue: number;
    balance: string;
    underlying: string;
    holdingWallet?: string;
    protocol: string;
    hasIdle?: boolean;
    isLP?: boolean;
  };
  discrepancy?: {
    difference: number;
    percentDiff: number;
  };
};

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

function normalizeAddr(s: string) {
  return s.toLowerCase().trim();
}

function pctDiff(a: number, b: number) {
  if (b === 0) return a === 0 ? 0 : 100;
  return ((a - b) / b) * 100;
}

async function fetchBackendEntries(): Promise<BackendEntry[]> {
  const MAX_RETRIES = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const backoffMs = 1000 * Math.pow(2, attempt - 1);
        console.log(`  Retrying in ${backoffMs}ms...`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
      console.log(`  Attempt ${attempt + 1}/${MAX_RETRIES}: GET ${BLOCK_ANALYTICA_URL}`);
      const res = await fetch(BLOCK_ANALYTICA_URL, {
        headers: { Accept: "application/json", "User-Agent": "SentinelWatch/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const json = (await res.json()) as { data: { results: BackendEntry[] } };
      if (!Array.isArray(json?.data?.results)) throw new Error("Unexpected response shape");
      return json.data.results;
    } catch (err) {
      lastError = err as Error;
      console.error(`  ✗ Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }
  throw new Error(`Block Analytica fetch failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
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

        if (typeof balanceResult === "object" && "idleBalance" in balanceResult) {
          balances[allocation.id] = {
            balance: balanceResult.balance,
            idleBalance: balanceResult.idleBalance,
          };
          console.log(
            `✓ [${allocation.id}] balance=${balanceResult.balance}, idleBalance=${balanceResult.idleBalance}`
          );
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
    errors.forEach(({ id, error }) => console.log(`  - ${id}: ${error}`));
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

  const allTokenIds = active.flatMap((a) => {
    const baseIds = a.priceOverride ? [a.underlying, a.priceOverride] : [a.underlying];
    if (a.hasIdle) {
      const priceKey = a.priceOverride || a.underlying;
      return [...baseIds, `${priceKey}-idle`];
    }
    return baseIds;
  });
  const uniqueTokenIds = [...new Set(allTokenIds)];

  console.log(
    `Fetching prices for ${uniqueTokenIds.length} unique token(s) from ${active.length} active allocation(s)`
  );
  console.log(`Timestamp: ${timestamp}\n`);

  console.log("Fetching prices from DefiLlama...");
  const llamaPrices = await getPrices(uniqueTokenIds);
  console.log(`DefiLlama returned ${Object.keys(llamaPrices).length}/${uniqueTokenIds.length} price(s)\n`);

  const missingIds = uniqueTokenIds.filter((id) => llamaPrices[id] == null);
  let customPrices: Record<string, number> = {};

  if (missingIds.length > 0) {
    console.log(`Fetching ${missingIds.length} missing price(s) via custom adapters...`);
    customPrices = await getCustomPrices(missingIds, llamaPrices);
    console.log(`Custom adapters resolved ${Object.keys(customPrices).length}/${missingIds.length} price(s)\n`);
  }

  const prices = { ...llamaPrices, ...customPrices };
  console.log(`Total prices resolved: ${Object.keys(prices).length}/${uniqueTokenIds.length}\n`);

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
  const details: AllocationDetail[] = [];

  for (const allocation of visible) {
    const balanceInfo = balanceData.balances[allocation.id];
    if (!balanceInfo || balanceInfo.error) {
      console.warn(`  ⊘ [${allocation.id}] Skipped: ${balanceInfo?.error || "No balance data"}`);
      continue;
    }

    const priceKey = allocation.priceOverride || allocation.underlying;
    const priceUSD = priceData.prices[priceKey] ?? 0;
    const rawBalance = Number(balanceInfo.balance);
    let usdValue = rawBalance * priceUSD;

    let rawIdleBalance = 0;
    let idleUsdValue = 0;

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

    if (allocation.isIdle) {
      idleUsdValue = usdValue + idleUsdValue;
      usdValue = 0;
    }

    const allocationEntry: { usdValue: number; idleUsdValue?: number } = {
      usdValue: round2(usdValue),
    };
    if (allocation.hasIdle || allocation.isIdle) {
      allocationEntry.idleUsdValue = round2(idleUsdValue);
    }
    entry.allocations[allocation.id] = allocationEntry;

    if (allocation.star) {
      entry.totals[allocation.star] = (entry.totals[allocation.star] ?? 0) + usdValue + idleUsdValue;
    }

    const detail: AllocationDetail = {
      id: allocation.id,
      star: allocation.star || "unknown",
      balance: String(rawBalance),
      priceKey,
      price: priceUSD,
      usdValue: round2(usdValue),
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

    if (allocation.hasIdle) {
      detail.idleBalance = String(rawIdleBalance);
      detail.idleUsdValue = round2(idleUsdValue);
    }

    details.push(detail);

    const status = priceUSD > 0 ? "✓" : "⚠";
    const idleInfo = allocation.hasIdle ? `, idle=$${round2(idleUsdValue)}` : "";
    console.log(
      `  ${status} [${allocation.id}] balance=${rawBalance.toFixed(6)}, price=$${priceUSD}, usd=$${round2(usdValue)}${idleInfo}`
    );
  }

  const roundedTotals = Object.fromEntries(
    Object.entries(entry.totals).map(([s, v]) => [s, round2(v)])
  );

  const response = { date: daySK, allocations: entry.allocations, totals: roundedTotals };

  console.log(`\nTotals by star:`);
  Object.entries(roundedTotals).forEach(([star, total]) =>
    console.log(`  ${star}: $${total.toLocaleString()}`)
  );

  const zeroBalances = details.filter((d) => Number(d.balance) === 0);
  const zeroPrices = details.filter((d) => d.price === 0 && Number(d.balance) > 0);

  if (zeroBalances.length > 0) {
    console.log(`\n⚠ Allocations with ZERO balance (${zeroBalances.length}):`);
    zeroBalances.forEach((d) => console.log(`    - ${d.id}`));
  }
  if (zeroPrices.length > 0) {
    console.log(`\n⚠ Allocations with ZERO price but non-zero balance (${zeroPrices.length}):`);
    zeroPrices.forEach((d) =>
      console.log(`    - ${d.id}: balance=${d.balance}, token=${d.priceKey}`)
    );
  }

  return { response, details };
}

// ---------------------------------------------------------------------------
// Step 4: Validate Against Backend Response
// ---------------------------------------------------------------------------

function buildAllocationMapping() {
  const mapping = new Map<string, { id: string; star: string; name: string }>();
  for (const alloc of allocations.filter(isActiveAllocation)) {
    const parts = alloc.underlying.split(":");
    const address = parts[1];
    const blockchain = parts[0];
    if (!address) continue;
    const key = `${normalizeAddr(address)}:${normalizeAddr(alloc.holdingWallet || "")}:${blockchain.toLowerCase()}`;
    mapping.set(key, { id: alloc.id, star: alloc.star || "unknown", name: alloc.name });
  }
  return mapping;
}

function validateAgainstBackend(
  details: AllocationDetail[],
  responseEntries: BackendEntry[]
): {
  results: ValidationResult[];
  unmatchedChartEntries: AllocationDetail[];
  responseEntries: BackendEntry[];
} {
  console.log(`Processing ${responseEntries.length} backend response entries\n`);

  const mapping = buildAllocationMapping();
  const detailsMap = new Map(details.map((d) => [d.id, d]));
  const results: ValidationResult[] = [];
  let matchedCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;

  for (const entry of responseEntries) {
    const key = `${normalizeAddr(entry.address)}:${normalizeAddr(entry.wallet_address)}:${entry.network.toLowerCase()}`;

    let allocationId: string | undefined = BACKEND_ADDRESS_OVERRIDES[key];
    if (!allocationId) {
      allocationId = mapping.get(key)?.id;
    }

    if (!allocationId) {
      missingCount++;
      results.push({
        status: "missing_in_chart",
        response_entry: {
          address: entry.address,
          wallet_address: entry.wallet_address,
          network: entry.network,
          token_symbol: entry.token_symbol,
          star: entry.star,
          allocated_assets: parseFloat(entry.allocated_assets),
        },
      });
      console.log(
        `  ✗ MISSING: ${entry.token_symbol} (${entry.network}) — $${parseFloat(entry.allocated_assets).toLocaleString()}`
      );
      console.log(`      address:      ${entry.address}`);
      console.log(`      wallet:       ${entry.wallet_address}`);
      console.log(`      star:         ${entry.star}`);
      console.log(`      protocol:     ${entry.protocol}`);
      console.log();
      continue;
    }

    const chartDetail = detailsMap.get(allocationId);
    if (!chartDetail) {
      missingCount++;
      results.push({
        status: "missing_in_chart",
        allocation_id: allocationId,
        response_entry: {
          address: entry.address,
          wallet_address: entry.wallet_address,
          network: entry.network,
          token_symbol: entry.token_symbol,
          star: entry.star,
          allocated_assets: parseFloat(entry.allocated_assets),
        },
      });
      console.log(`  ✗ MISSING CHART DATA: ${allocationId} (${entry.token_symbol})`);
      continue;
    }

    const allocatedAssets = parseFloat(entry.allocated_assets);
    const chartUsd = chartDetail.usdValue;
    const difference = chartUsd - allocatedAssets;
    const percentDiff = pctDiff(chartUsd, allocatedAssets);
    const isMismatch = Math.abs(percentDiff) > DISCREPANCY_THRESHOLD_PERCENT;

    const result: ValidationResult = {
      status: isMismatch ? "value_mismatch" : "matched",
      allocation_id: allocationId,
      response_entry: {
        address: entry.address,
        wallet_address: entry.wallet_address,
        network: entry.network,
        token_symbol: entry.token_symbol,
        star: entry.star,
        allocated_assets: allocatedAssets,
      },
      chart_entry: {
        id: chartDetail.id,
        usdValue: chartUsd,
        balance: chartDetail.balance,
        underlying: chartDetail.underlying,
        holdingWallet: chartDetail.holdingWallet,
        protocol: chartDetail.protocol,
        hasIdle: chartDetail.hasIdle,
        isLP: chartDetail.isLP,
      },
      discrepancy: { difference, percentDiff },
    };
    results.push(result);

    if (isMismatch) {
      mismatchCount++;
      const dir = difference > 0 ? "higher" : "lower";
      console.log(`  ⚠ MISMATCH: ${allocationId}`);
      console.log(`      Token:    ${entry.token_symbol} (${entry.network})`);
      console.log(`      Chart:    $${chartUsd.toLocaleString()}`);
      console.log(`      Backend:  $${allocatedAssets.toLocaleString()}`);
      console.log(
        `      Delta:    $${Math.abs(difference).toLocaleString()} ${dir} (${percentDiff.toFixed(2)}%)`
      );
      if (chartDetail.hasIdle) console.log(`      💡 hasIdle=true — check idle/active split`);
      if (chartDetail.isLP) console.log(`      💡 LP position — valuation method may differ`);
      console.log();
    } else {
      matchedCount++;
      console.log(`  ✓ MATCHED: ${allocationId}  $${allocatedAssets.toLocaleString()}`);
    }
  }

  // Chart entries not found in backend response
  const matchedIds = new Set(
    responseEntries
      .map((e) => {
        const k = `${normalizeAddr(e.address)}:${normalizeAddr(e.wallet_address)}:${e.network.toLowerCase()}`;
        return BACKEND_ADDRESS_OVERRIDES[k] ?? mapping.get(k)?.id;
      })
      .filter(Boolean) as string[]
  );
  const unmatchedChartEntries = details.filter((d) => !matchedIds.has(d.id));

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total backend entries:     ${responseEntries.length}`);
  console.log(`✓ Matched (≤${DISCREPANCY_THRESHOLD_PERCENT}%):          ${matchedCount}`);
  console.log(`⚠ Value mismatches:        ${mismatchCount}`);
  console.log(`✗ Missing in chart:        ${missingCount}`);
  console.log(`📋 Chart-only entries:     ${unmatchedChartEntries.length}`);

  const healthScore = (matchedCount / responseEntries.length) * 100;
  const healthLabel =
    healthScore >= 95 ? "🟢 EXCELLENT" :
    healthScore >= 80 ? "🟡 GOOD" :
    healthScore >= 60 ? "🟠 NEEDS ATTENTION" : "🔴 CRITICAL";
  console.log(`\n${healthLabel}  (${healthScore.toFixed(1)}% match rate)`);
  console.log("=".repeat(80));

  if (unmatchedChartEntries.length > 0) {
    console.log(`\n📋 Chart entries not found in backend response (${unmatchedChartEntries.length}):`);
    for (const e of unmatchedChartEntries) {
      console.log(`  • ${e.id} (${e.star}) — $${e.usdValue.toLocaleString()}`);
      console.log(`      protocol: ${e.protocol} | network: ${e.blockchain}`);
      console.log(`      underlying: ${e.underlying}`);
      console.log(`      holdingWallet: ${e.holdingWallet || "N/A"}`);
    }
  }

  return { results, unmatchedChartEntries, responseEntries };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n" + "█".repeat(80));
  console.log("Test Allocation Chart Pipeline");
  console.log("█".repeat(80));

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`\nCreated output directory: ${OUTPUT_DIR}`);
  }

  const startTime = Date.now();

  try {
    // Step 1: Fetch balances
    const balanceData = await fetchAllBalances();
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "1_balances.json"),
      JSON.stringify(balanceData, null, 2)
    );
    console.log(`\n→ Wrote: cli-output/1_balances.json`);

    // Step 2: Fetch prices
    const priceData = await fetchAllPrices();
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "2_prices.json"),
      JSON.stringify(priceData, null, 2)
    );
    console.log(`\n→ Wrote: cli-output/2_prices.json`);

    // Step 3: Generate chart
    const { response, details } = await generateLatestChart(balanceData, priceData);
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "3_latest_allocation_chart.json"),
      JSON.stringify(response, null, 2)
    );
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "4_allocation_details.json"),
      JSON.stringify(details, null, 2)
    );
    console.log(`\n→ Wrote: cli-output/3_latest_allocation_chart.json`);
    console.log(`→ Wrote: cli-output/4_allocation_details.json`);

    // Step 4: Fetch live backend data and validate
    console.log("\n" + "=".repeat(80));
    console.log("STEP 4: Validating Against Block Analytica Live Data");
    console.log("=".repeat(80) + "\n");

    const allResponseEntries = await fetchBackendEntries();
    const responseEntries = allResponseEntries.filter((e) => parseFloat(e.allocated_assets) >= 10_000);
    console.log(
      `✓ Fetched ${allResponseEntries.length} entries from Block Analytica` +
      ` (${allResponseEntries.length - responseEntries.length} filtered out with allocated_assets < $10,000)\n`
    );

    const { results, unmatchedChartEntries } = validateAgainstBackend(details, responseEntries);

    const missingInChartFull = results
      .filter((r) => r.status === "missing_in_chart")
      .map((r) =>
        responseEntries.find(
          (e) =>
            e.address.toLowerCase() === r.response_entry.address.toLowerCase() &&
            e.wallet_address.toLowerCase() === r.response_entry.wallet_address.toLowerCase() &&
            e.network.toLowerCase() === r.response_entry.network.toLowerCase()
        )
      )
      .filter(Boolean);

    const report = {
      timestamp: new Date().toISOString(),
      source: BLOCK_ANALYTICA_URL,
      summary: {
        total_response_entries: responseEntries.length,
        matched: results.filter((r) => r.status === "matched").length,
        value_mismatches: results.filter((r) => r.status === "value_mismatch").length,
        missing_in_chart: results.filter((r) => r.status === "missing_in_chart").length,
        chart_entries_not_in_response: unmatchedChartEntries.length,
      },
      missing_in_chart: missingInChartFull.length > 0 ? missingInChartFull : null,
      value_mismatches: results
        .filter((r) => r.status === "value_mismatch")
        .sort((a, b) => Math.abs(b.discrepancy!.difference) - Math.abs(a.discrepancy!.difference)),
      chart_entries_not_in_response: unmatchedChartEntries,
    };

    fs.writeFileSync(
      path.join(OUTPUT_DIR, "5_validation_report.json"),
      JSON.stringify(report, null, 2)
    );
    console.log(`\n→ Wrote: cli-output/5_validation_report.json`);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n" + "█".repeat(80));
    console.log(`PIPELINE COMPLETE  (${elapsed}s)`);
    console.log("█".repeat(80) + "\n");
  } catch (err) {
    console.error("\n" + "█".repeat(80));
    console.error("PIPELINE FAILED");
    console.error("█".repeat(80));
    console.error(err);
    process.exit(1);
  }
}

main();
