/**
 * Validation Logic: Cross-reference allocation chart outputs with Block Analytica allocations
 *
 * This module validates our internal allocation data against Block Analytica's API data.
 * It performs the exact same validation as the CLI script but fetches data from the database.
 */

import { db, blockAnaliticaSnapshots, validationReports, allocationBalances, tokenPrices } from "./db";
import { desc, eq, and } from "drizzle-orm";
import allocations from "../../allocationData/allocations";
import { isActiveAllocation, type AllocationConfig } from "../../allocationData/types";

// Threshold for flagging discrepancies (as percentage)
const DISCREPANCY_THRESHOLD_PERCENT = 5; // Flag if difference > 5%

// Backend Address Mapping (same as validateAllocations.ts)
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
// Helper Functions
// ---------------------------------------------------------------------------

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().trim();
}

function calculatePercentDiff(value1: number, value2: number): number {
  if (value2 === 0) return value1 === 0 ? 0 : 100;
  return ((value1 - value2) / value2) * 100;
}

// ---------------------------------------------------------------------------
// Build Allocation Mapping
// ---------------------------------------------------------------------------

function buildAllocationMapping() {
  const mapping = new Map<string, {
    id: string;
    address: string;
    holdingWallet: string;
    blockchain: string;
    star: string;
    name: string;
  }>();

  const activeAllocations = allocations.filter(isActiveAllocation);

  for (const alloc of activeAllocations) {
    const [blockchain, address] = alloc.underlying.split(":");
    
    if (!address) {
      continue;
    }

    const key = `${normalizeAddress(address)}:${normalizeAddress(alloc.holdingWallet || "")}:${blockchain.toLowerCase()}`;
    
    mapping.set(key, {
      id: alloc.id,
      address: normalizeAddress(address),
      holdingWallet: normalizeAddress(alloc.holdingWallet || ""),
      blockchain: blockchain.toLowerCase(),
      star: alloc.star || "unknown",
      name: alloc.name,
    });
  }

  return mapping;
}

// ---------------------------------------------------------------------------
// Fetch Latest Allocation Chart Data from DB
// ---------------------------------------------------------------------------

async function getLatestAllocationChartData() {
  // Get latest prices
  const latestPrices = await db
    .select()
    .from(tokenPrices)
    .where(eq(tokenPrices.granularity, "daily"))
    .orderBy(desc(tokenPrices.timestamp))
    .limit(1);

  if (latestPrices.length === 0) {
    console.log("  No price data found in database - returning empty chart data");
    return new Map();
  }

  const prices = latestPrices[0].prices;

  // Get latest balance for each allocation
  const chartData = new Map<string, any>();
  
  for (const alloc of allocations.filter(isActiveAllocation)) {
    const latestBalance = await db
      .select()
      .from(allocationBalances)
      .where(
        and(
          eq(allocationBalances.allocationId, alloc.id),
          eq(allocationBalances.granularity, "daily")
        )
      )
      .orderBy(desc(allocationBalances.timestamp))
      .limit(1);

    if (latestBalance.length === 0) {
      continue;
    }

    const balance = latestBalance[0];
    const priceKey = alloc.priceOverride || alloc.underlying;
    const price = prices[priceKey] || 0;
    const rawBalance = balance.balanceData.balance != null ? Number(balance.balanceData.balance) : 0;
    const usdValue = rawBalance * price;

    chartData.set(alloc.id, {
      id: alloc.id,
      star: alloc.star,
      balance: String(rawBalance),
      priceKey,
      price,
      usdValue,
      name: alloc.name,
      protocol: alloc.protocol,
      blockchain: alloc.blockchain,
      type: alloc.type,
      underlying: alloc.underlying,
      holdingWallet: alloc.holdingWallet,
      containsIdle: alloc.containsIdle,
      isLP: alloc.isLP,
      isLending: alloc.isLending,
      isYBS: alloc.isYBS,
    });
  }

  return chartData;
}

// ---------------------------------------------------------------------------
// Run Validation
// ---------------------------------------------------------------------------

export async function runValidation(): Promise<any> {
  console.log("Running allocation validation...");

  // Fetch latest Block Analytica snapshot
  const latestSnapshot = await db
    .select()
    .from(blockAnaliticaSnapshots)
    .orderBy(desc(blockAnaliticaSnapshots.timestamp))
    .limit(1);

  if (latestSnapshot.length === 0) {
    throw new Error("No Block Analytica snapshots found in database");
  }

  const snapshot = latestSnapshot[0];
  const allResponseEntries = snapshot.responseData.data.results;

  // Filter allocations with allocated_assets >= 1000
  const responseEntries = allResponseEntries.filter((entry: any) => {
    const allocatedAssets = parseFloat(entry.allocated_assets);
    return allocatedAssets >= 1000;
  });

  console.log(`Loaded ${responseEntries.length} Block Analytica entries (filtered >= 1000)`);

  // Build allocation mapping
  const mapping = buildAllocationMapping();

  // Get latest allocation chart data
  const detailsMap = await getLatestAllocationChartData();
  console.log(`Loaded ${detailsMap.size} allocation chart entries`);

  // Perform validation
  const results: any[] = [];
  let matchedCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;

  for (const entry of responseEntries) {
    const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
    
    // Check override mapping first
    let allocationId: string | undefined;
    if (BACKEND_ADDRESS_OVERRIDES[key]) {
      allocationId = BACKEND_ADDRESS_OVERRIDES[key];
    } else {
      const allocConfig = mapping.get(key);
      allocationId = allocConfig?.id;
    }

    const chartEntry = allocationId ? detailsMap.get(allocationId) : undefined;

    if (!chartEntry) {
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
      continue;
    }

    const allocatedAssets = parseFloat(entry.allocated_assets);
    const { usdValue } = chartEntry;
    const difference = Math.abs(usdValue - allocatedAssets);
    const percentDiff = calculatePercentDiff(usdValue, allocatedAssets);

    if (Math.abs(percentDiff) > DISCREPANCY_THRESHOLD_PERCENT) {
      mismatchCount++;
      results.push({
        status: "value_mismatch",
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
          id: chartEntry.id,
          usdValue: chartEntry.usdValue,
          balance: chartEntry.balance,
          underlying: chartEntry.underlying,
          holdingWallet: chartEntry.holdingWallet,
          protocol: chartEntry.protocol,
          containsIdle: chartEntry.containsIdle,
          isLP: chartEntry.isLP,
        },
        discrepancy: {
          difference,
          percentDiff,
        },
      });
    } else {
      matchedCount++;
      results.push({
        status: "matched",
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
          id: chartEntry.id,
          usdValue: chartEntry.usdValue,
        },
      });
    }
  }

  // Find chart entries not in response
  const matchedIds = new Set<string>();
  for (const entry of responseEntries) {
    const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
    
    let allocationId: string | undefined;
    if (BACKEND_ADDRESS_OVERRIDES[key]) {
      allocationId = BACKEND_ADDRESS_OVERRIDES[key];
    } else {
      const allocConfig = mapping.get(key);
      allocationId = allocConfig?.id;
    }
    
    if (allocationId) {
      matchedIds.add(allocationId);
    }
  }

  const unmatchedChartEntries: any[] = [];
  for (const [id, detail] of Array.from(detailsMap.entries())) {
    if (!matchedIds.has(id)) {
      unmatchedChartEntries.push(detail);
    }
  }

  // Collect full raw entries missing in chart
  const missingInChartEntries = results
    .filter(r => r.status === "missing_in_chart")
    .map(r => {
      return allResponseEntries.find((entry: any) => 
        entry.address.toLowerCase() === r.response_entry.address.toLowerCase() &&
        entry.wallet_address.toLowerCase() === r.response_entry.wallet_address.toLowerCase() &&
        entry.network.toLowerCase() === r.response_entry.network.toLowerCase()
      );
    })
    .filter(entry => entry !== undefined);

  // Generate report in exact same format as original
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total_response_entries: responseEntries.length,
      matched: matchedCount,
      value_mismatches: mismatchCount,
      missing_in_chart: missingCount,
      chart_entries_not_in_response: unmatchedChartEntries.length,
    },
    missing_in_chart: missingInChartEntries.length > 0 ? missingInChartEntries : null,
    unmatched_chart_entries: unmatchedChartEntries.map(e => ({
      id: e.id,
      star: e.star,
      usdValue: e.usdValue,
      balance: e.balance,
      priceKey: e.priceKey,
    })),
  };

  console.log(`Validation complete: ${matchedCount} matched, ${mismatchCount} mismatches, ${missingCount} missing`);

  return report;
}

/**
 * Run validation and store report in database
 */
export async function runValidationAndStore(timestamp: number): Promise<void> {
  try {
    const report = await runValidation();

    await db
      .insert(validationReports)
      .values({
        timestamp,
        reportData: report,
      })
      .onConflictDoUpdate({
        target: [validationReports.timestamp],
        set: { reportData: report },
      });

    console.log("✓ Validation report stored in database");
  } catch (err) {
    console.error("✗ Validation failed:", err);
    throw err;
  }
}
