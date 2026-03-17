/**
 * Validation Script: Cross-reference allocation chart outputs with allocations_response
 *
 * This script:
 * 1. Loads the allocations config to create a mapping of addresses to allocation IDs
 * 2. Loads the allocation chart output (with usdValue calculations)
 * 3. Loads the allocations_response data (with allocated_assets from backend)
 * 4. Cross-references entries to compare usdValue vs allocated_assets
 * 5. Flags entries in allocations_response that don't have matching outputs
 * 6. Reports discrepancies and generates a validation report
 *
 * Usage: npx ts-node scripts/validateAllocations.ts
 */

import * as fs from "fs";
import * as path from "path";
import allocations from "../src/allocationData/allocations";
import { isActiveAllocation } from "../src/allocationData/types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALLOCATION_DETAILS_PATH = path.join(__dirname, "../cli-output/4_allocation_details.json");
const ALLOCATIONS_RESPONSE_PATH = path.join(__dirname, "../docs/allocations_response_mar_17th_filtered.json");
const OUTPUT_PATH = path.join(__dirname, "../cli-output/5_validation_report.json");

// Threshold for flagging discrepancies (as percentage)
const DISCREPANCY_THRESHOLD_PERCENT = 5; // Flag if difference > 5%

// ---------------------------------------------------------------------------
// Backend Address Mapping (for validation only)
// 
// The backend tracks different addresses than our config for some allocations.
// Our config tracks the underlying token, backend tracks the wrapper/contract.
// This mapping only affects validation matching - it does NOT change our config
// or backend processing logic.
// ---------------------------------------------------------------------------

interface BackendAddressMapping {
  // Key: backend_address:wallet_address:network (lowercase)
  // Value: allocation_id from our config
  [key: string]: string;
}

const BACKEND_ADDRESS_OVERRIDES: BackendAddressMapping = {
  // PSM3 Contracts - backend tracks PSM3 contract, we track USDC
  "0x7b42ed932f26509465f7ce3faf76ffce1275312f:0x345e368fccd62266b3f5f37c9a131fd1c39f5869:unichain": 
    "spark-unichain-psm3-usdc-unichain",
  "0x1601843c5e9bc251a3272907010afa41fa18347e:0x2917956eff0b5eaf030abdb4ef4296df775009ca:base": 
    "spark-base-psm3-usdc-base",
  "0x2b05f8e1cacc6974fd79a673a341fe1f58d27266:0x92afd6f2385a90e44da3a8b60fe36f6cbe1d8709:arbitrum": 
    "spark-arbitrum-psm3-usdc-arbitrum",
  "0xe0f9978b907853f354d79188a3defbd41978af62:0x876664f0c9ff24d1aa355ce9f1680ae1a5bf36fb:optimism": 
    "spark-optimism-psm3-usdc-optimism",
  
  // Anchorage - backend tracks contract address, we track USDC
  "0x49506c3aa028693458d6ee816b2ec28522946872:0x1601843c5e9bc251a3272907010afa41fa18347e:ethereum": 
    "spark-anchorage-ethereum",
  
  // Uniswap V3 LP - backend tracks position/pool address, we track with special format
  "0xbafead7c60ea473758ed6c6021505e8bbd7e8e5d:0x491edfb0b8b608044e227225c715981a30f3a44e:ethereum": 
    "grove-uniswap-lp-ausd-usdc-ethereum",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AllocationDetail {
  id: string;
  star: string;
  balance: string;
  priceKey: string;
  price: number;
  usdValue: number;
  // Enhanced metadata
  name: string;
  protocol: string;
  blockchain: string;
  type: string;
  underlying: string;
  holdingWallet?: string;
  containsIdle?: boolean;
  isLP?: boolean;
  isLending?: boolean;
  isYBS?: boolean;
}

interface AllocationsResponseEntry {
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
}

interface ValidationResult {
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
    containsIdle?: boolean;
    isLP?: boolean;
  };
  discrepancy?: {
    difference: number;
    percentDiff: number;
  };
}

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function normalizeAddress(addr: string): string {
  return addr.toLowerCase().trim();
}

function normalizeStar(star: string): string {
  return star.toLowerCase().trim();
}

function calculatePercentDiff(value1: number, value2: number): number {
  if (value2 === 0) return value1 === 0 ? 0 : 100;
  return ((value1 - value2) / value2) * 100;
}

// ---------------------------------------------------------------------------
// Build Allocation Mapping
// ---------------------------------------------------------------------------

function buildAllocationMapping() {
  console.log("Building allocation mapping from config...\n");

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
    // Extract address from underlying (format: "blockchain:address")
    const [blockchain, address] = alloc.underlying.split(":");
    
    if (!address) {
      console.warn(`  ⚠ Skipping ${alloc.id}: invalid underlying format "${alloc.underlying}"`);
      continue;
    }

    // Create a composite key: address + wallet + blockchain
    const key = `${normalizeAddress(address)}:${normalizeAddress(alloc.holdingWallet || "")}:${blockchain.toLowerCase()}`;
    
    mapping.set(key, {
      id: alloc.id,
      address: normalizeAddress(address),
      holdingWallet: normalizeAddress(alloc.holdingWallet || ""),
      blockchain: blockchain.toLowerCase(),
      star: alloc.star || "unknown",
      name: alloc.name,
    });

    console.log(`  ✓ [${alloc.id}] ${blockchain}:${address.slice(0, 10)}... (${alloc.star})`);
  }

  console.log(`\nMapped ${mapping.size} active allocation(s)\n`);
  return mapping;
}

// ---------------------------------------------------------------------------
// Load Data Files
// ---------------------------------------------------------------------------

function loadAllocationDetails(): Map<string, AllocationDetail> {
  console.log("Loading allocation details from chart output...\n");
  
  const raw = fs.readFileSync(ALLOCATION_DETAILS_PATH, "utf8");
  const details: AllocationDetail[] = JSON.parse(raw);
  
  const map = new Map<string, AllocationDetail>();
  for (const detail of details) {
    map.set(detail.id, detail);
  }

  console.log(`Loaded ${map.size} allocation detail(s)\n`);
  return map;
}

function loadAllocationsResponse(): AllocationsResponseEntry[] {
  console.log("Loading allocations response data...\n");
  
  const raw = fs.readFileSync(ALLOCATIONS_RESPONSE_PATH, "utf8");
  const data = JSON.parse(raw);
  const entries: AllocationsResponseEntry[] = data.data.results;

  console.log(`Loaded ${entries.length} allocation response entries\n`);
  return entries;
}

// ---------------------------------------------------------------------------
// Validation Logic
// ---------------------------------------------------------------------------

function validateAllocations(
  mapping: Map<string, any>,
  detailsMap: Map<string, AllocationDetail>,
  responseEntries: AllocationsResponseEntry[]
): ValidationResult[] {
  console.log("=".repeat(80));
  console.log("VALIDATION RESULTS");
  console.log("=".repeat(80) + "\n");

  const results: ValidationResult[] = [];
  let matchedCount = 0;
  let mismatchCount = 0;
  let missingCount = 0;

  for (const entry of responseEntries) {
    // Build the composite key to look up in our mapping
    const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
    
    // First check if this backend address has an explicit override mapping
    let allocationId: string | undefined;
    let allocConfig: any;
    
    if (BACKEND_ADDRESS_OVERRIDES[key]) {
      // Use the override mapping
      allocationId = BACKEND_ADDRESS_OVERRIDES[key];
      console.log(`  🔄 Using address override: ${entry.token_symbol} -> ${allocationId}`);
    } else {
      // Try normal mapping
      allocConfig = mapping.get(key);
      allocationId = allocConfig?.id;
    }
    
    if (!allocationId) {
      // Entry in response but not in our allocation config
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

      console.log(`  ✗ MISSING: ${entry.token_symbol} (${entry.network}) - $${parseFloat(entry.allocated_assets).toLocaleString()}`);
      console.log(`      address: ${entry.address}`);
      console.log(`      wallet: ${entry.wallet_address}`);
      console.log(`      star: ${entry.star}\n`);
      continue;
    }

    // Found matching allocation ID, now check if we have chart output
    const chartDetail = detailsMap.get(allocationId);
    
    if (!chartDetail) {
      // Config exists but no chart output (shouldn't happen for active allocations)
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

    // Compare values
    const allocatedAssets = parseFloat(entry.allocated_assets);
    const usdValue = chartDetail.usdValue;
    const difference = usdValue - allocatedAssets;
    const percentDiff = calculatePercentDiff(usdValue, allocatedAssets);

    const result: ValidationResult = {
      status: Math.abs(percentDiff) > DISCREPANCY_THRESHOLD_PERCENT ? "value_mismatch" : "matched",
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
        usdValue: usdValue,
        balance: chartDetail.balance,
        underlying: chartDetail.underlying,
        holdingWallet: chartDetail.holdingWallet,
        protocol: chartDetail.protocol,
        containsIdle: chartDetail.containsIdle,
        isLP: chartDetail.isLP,
      },
      discrepancy: {
        difference: difference,
        percentDiff: percentDiff,
      },
    };

    results.push(result);

    if (result.status === "value_mismatch") {
      mismatchCount++;
      console.log(`  ⚠ MISMATCH: ${allocationId}`);
      console.log(`      Token: ${entry.token_symbol} (${entry.network})`);
      console.log(`      Chart usdValue:    $${usdValue.toLocaleString()}`);
      console.log(`      Response allocated: $${allocatedAssets.toLocaleString()}`);
      console.log(`      Difference:         $${difference.toLocaleString()} (${percentDiff.toFixed(2)}%)`);
      
      // Add helpful context about potential causes
      if (chartDetail.containsIdle) {
        console.log(`      ⚠ Note: Config indicates containsIdle=true. Chart may be including idle assets.`);
      }
      if (chartDetail.isLP) {
        console.log(`      ⚠ Note: This is an LP position. Valuation methodology may differ.`);
      }
      console.log();
    } else {
      matchedCount++;
      console.log(`  ✓ MATCHED: ${allocationId} - ${entry.token_symbol} ($${allocatedAssets.toLocaleString()})`);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(80));
  console.log(`Total entries in response: ${responseEntries.length}`);
  console.log(`Matched (within ${DISCREPANCY_THRESHOLD_PERCENT}% threshold): ${matchedCount}`);
  console.log(`Value mismatches (>${DISCREPANCY_THRESHOLD_PERCENT}% difference): ${mismatchCount}`);
  console.log(`Missing in chart output: ${missingCount}`);
  
  // Count how many overrides were actually used
  const overridesUsed = responseEntries.filter(entry => {
    const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
    return BACKEND_ADDRESS_OVERRIDES[key] !== undefined;
  }).length;
  
  if (overridesUsed > 0) {
    console.log(`Backend address overrides applied: ${overridesUsed}`);
  }
  
  console.log("=".repeat(80) + "\n");

  return results;
}

// ---------------------------------------------------------------------------
// Check for Chart Entries Not in Response
// ---------------------------------------------------------------------------

function checkUnmatchedChartEntries(
  detailsMap: Map<string, AllocationDetail>,
  responseEntries: AllocationsResponseEntry[],
  mapping: Map<string, any>
) {
  console.log("=".repeat(80));
  console.log("CHECKING FOR CHART ENTRIES NOT IN RESPONSE");
  console.log("=".repeat(80) + "\n");

  // Build a set of allocation IDs that were matched in the response
  const matchedIds = new Set<string>();
  
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
    
    if (allocationId) {
      matchedIds.add(allocationId);
    }
  }

  // Find chart entries that weren't matched
  const unmatchedEntries: AllocationDetail[] = [];
  for (const [id, detail] of detailsMap) {
    if (!matchedIds.has(id)) {
      unmatchedEntries.push(detail);
    }
  }

  if (unmatchedEntries.length === 0) {
    console.log("✓ All chart entries have corresponding response entries\n");
    return unmatchedEntries;
  }

  console.log(`Found ${unmatchedEntries.length} chart entries WITHOUT corresponding response entries:\n`);
  
  for (const entry of unmatchedEntries) {
    console.log(`  • ${entry.id} (${entry.star})`);
    console.log(`      Name: ${entry.name}`);
    console.log(`      USD Value: $${entry.usdValue.toLocaleString()}`);
    console.log(`      Balance: ${entry.balance}`);
    console.log(`      Underlying: ${entry.underlying}`);
    console.log(`      Holding Wallet: ${entry.holdingWallet || "N/A"}`);
    console.log(`      Protocol: ${entry.protocol} | Network: ${entry.blockchain}`);
    if (entry.containsIdle) console.log(`      ⚠ Contains Idle Assets`);
    if (entry.isLP) console.log(`      ⚠ LP Position`);
    console.log();
  }

  return unmatchedEntries;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n" + "█".repeat(80));
  console.log("ALLOCATION VALIDATION SCRIPT");
  console.log("█".repeat(80) + "\n");

  try {
    // Step 1: Build allocation mapping from config
    const mapping = buildAllocationMapping();

    // Step 2: Load allocation details (chart output)
    const detailsMap = loadAllocationDetails();

    // Step 3: Load allocations response data
    const responseEntries = loadAllocationsResponse();

    // Step 4: Validate and cross-reference
    const results = validateAllocations(mapping, detailsMap, responseEntries);

    // Step 5: Check for unmatched chart entries
    const unmatchedChartEntries = checkUnmatchedChartEntries(detailsMap, responseEntries, mapping);

    // Step 5.5: Report on backend address overrides used
    console.log("=".repeat(80));
    console.log("BACKEND ADDRESS OVERRIDES");
    console.log("=".repeat(80) + "\n");
    
    // Track which backend address overrides were used
    const usedOverridesInfo: Array<{
      backend_address: string;
      wallet_address: string;
      network: string;
      allocation_id: string;
      reason: string;
    }> = [];
    
    const overriddenEntries = responseEntries.filter(entry => {
      const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
      return BACKEND_ADDRESS_OVERRIDES[key] !== undefined;
    });
    
    for (const entry of overriddenEntries) {
      const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
      usedOverridesInfo.push({
        backend_address: entry.address,
        wallet_address: entry.wallet_address,
        network: entry.network,
        allocation_id: BACKEND_ADDRESS_OVERRIDES[key],
        reason: "Backend tracks contract/wrapper address, config tracks underlying token",
      });
    }
    
    if (overriddenEntries.length > 0) {
      console.log(`Applied ${overriddenEntries.length} backend address override(s):\n`);
      overriddenEntries.forEach(entry => {
        const key = `${normalizeAddress(entry.address)}:${normalizeAddress(entry.wallet_address)}:${entry.network.toLowerCase()}`;
        const allocationId = BACKEND_ADDRESS_OVERRIDES[key];
        console.log(`  • ${allocationId}`);
        console.log(`      Backend tracks: ${entry.address} (${entry.network})`);
        console.log(`      Token: ${entry.token_symbol}`);
        console.log(`      Reason: Backend uses contract/wrapper, config uses underlying token\n`);
      });
    } else {
      console.log("No backend address overrides were needed for this validation.\n");
    }
    
    console.log(`Total overrides configured: ${Object.keys(BACKEND_ADDRESS_OVERRIDES).length}`);
    console.log(`Overrides used: ${overriddenEntries.length}\n`);

    // Collect full raw entries that are missing in chart
    const missingInChartEntries = results
      .filter(r => r.status === "missing_in_chart")
      .map(r => {
        // Find the full entry from responseEntries
        return responseEntries.find(entry => 
          entry.address.toLowerCase() === r.response_entry.address.toLowerCase() &&
          entry.wallet_address.toLowerCase() === r.response_entry.wallet_address.toLowerCase() &&
          entry.network.toLowerCase() === r.response_entry.network.toLowerCase()
        );
      })
      .filter(entry => entry !== undefined);

    // Step 6: Generate report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_response_entries: responseEntries.length,
        matched: results.filter(r => r.status === "matched").length,
        value_mismatches: results.filter(r => r.status === "value_mismatch").length,
        missing_in_chart: results.filter(r => r.status === "missing_in_chart").length,
        chart_entries_not_in_response: unmatchedChartEntries.length,
      },
      missing_in_chart: missingInChartEntries.length > 0 ? missingInChartEntries : null,
      unmatched_chart_entries: unmatchedChartEntries.map(e => ({
        id: e.id,
        name: e.name,
        star: e.star,
        usdValue: e.usdValue,
        balance: e.balance,
        underlying: e.underlying,
        holdingWallet: e.holdingWallet,
        protocol: e.protocol,
        blockchain: e.blockchain,
        type: e.type,
        priceKey: e.priceKey,
        containsIdle: e.containsIdle,
        isLP: e.isLP,
      })),
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
    console.log(`\n→ Validation report written to: ${OUTPUT_PATH}\n`);

    console.log("█".repeat(80));
    console.log("VALIDATION COMPLETE");
    console.log("█".repeat(80) + "\n");

  } catch (err) {
    console.error("\n" + "█".repeat(80));
    console.error("VALIDATION FAILED");
    console.error("█".repeat(80));
    console.error(err);
    process.exit(1);
  }
}

main();
