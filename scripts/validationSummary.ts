/**
 * Quick Validation Summary
 * 
 * Reads the validation report and displays a concise summary.
 * Run this after validateAllocations.ts to get a quick overview.
 * 
 * Usage: npx ts-node scripts/validationSummary.ts
 */

import * as fs from "fs";
import * as path from "path";

const VALIDATION_REPORT_PATH = path.join(__dirname, "../cli-output/5_validation_report.json");

interface ValidationReport {
  timestamp: string;
  summary: {
    total_response_entries: number;
    matched: number;
    value_mismatches: number;
    missing_in_chart: number;
    chart_entries_not_in_response: number;
  };
  config: {
    discrepancy_threshold_percent: number;
  };
  results: Array<{
    status: string;
    allocation_id?: string;
    response_entry: any;
    chart_entry?: any;
    discrepancy?: {
      difference: number;
      percentDiff: number;
    };
  }>;
  unmatched_chart_entries: Array<any>;
}

function main() {
  console.log("\n" + "=".repeat(80));
  console.log("VALIDATION SUMMARY");
  console.log("=".repeat(80) + "\n");

  if (!fs.existsSync(VALIDATION_REPORT_PATH)) {
    console.error("❌ Validation report not found!");
    console.error(`Expected at: ${VALIDATION_REPORT_PATH}`);
    console.error("\nPlease run: npx ts-node scripts/validateAllocations.ts\n");
    process.exit(1);
  }

  const report: ValidationReport = JSON.parse(fs.readFileSync(VALIDATION_REPORT_PATH, "utf8"));
  
  console.log(`📅 Report Generated: ${new Date(report.timestamp).toLocaleString()}`);
  console.log(`📊 Threshold: ${report.config.discrepancy_threshold_percent}% difference\n`);

  // Overall stats
  const { summary } = report;
  const totalChecked = summary.total_response_entries;
  const matchRate = ((summary.matched / totalChecked) * 100).toFixed(1);

  console.log("📈 Overall Statistics:");
  console.log(`   Total entries checked: ${totalChecked}`);
  console.log(`   ✓ Matched: ${summary.matched} (${matchRate}%)`);
  console.log(`   ⚠ Value mismatches: ${summary.value_mismatches}`);
  console.log(`   ✗ Missing in chart: ${summary.missing_in_chart}`);
  console.log(`   📋 Chart entries not in response: ${summary.chart_entries_not_in_response}\n`);

  // Health indicator
  const healthScore = (summary.matched / totalChecked) * 100;
  let healthStatus = "";
  let healthEmoji = "";
  
  if (healthScore >= 95) {
    healthStatus = "EXCELLENT";
    healthEmoji = "🟢";
  } else if (healthScore >= 80) {
    healthStatus = "GOOD";
    healthEmoji = "🟡";
  } else if (healthScore >= 60) {
    healthStatus = "NEEDS ATTENTION";
    healthEmoji = "🟠";
  } else {
    healthStatus = "CRITICAL";
    healthEmoji = "🔴";
  }

  console.log(`${healthEmoji} Data Quality: ${healthStatus} (${healthScore.toFixed(1)}% match rate)\n`);

  // Top mismatches by dollar amount
  const mismatches = report.results
    .filter(r => r.status === "value_mismatch")
    .sort((a, b) => Math.abs(b.discrepancy!.difference) - Math.abs(a.discrepancy!.difference));

  if (mismatches.length > 0) {
    console.log("⚠️  Top Value Mismatches by Dollar Amount:\n");
    mismatches.slice(0, 5).forEach((m, idx) => {
      const diff = m.discrepancy!.difference;
      const pct = m.discrepancy!.percentDiff;
      const symbol = m.response_entry.token_symbol;
      const direction = diff > 0 ? "higher" : "lower";
      
      console.log(`   ${idx + 1}. ${m.allocation_id}`);
      console.log(`      Token: ${symbol}`);
      console.log(`      Chart is $${Math.abs(diff).toLocaleString()} ${direction} (${Math.abs(pct).toFixed(1)}%)`);
      
      if (m.chart_entry?.containsIdle) {
        console.log(`      💡 Hint: Contains idle assets`);
      }
      if (m.chart_entry?.isLP) {
        console.log(`      💡 Hint: LP position - check valuation method`);
      }
      console.log();
    });
  }

  // Missing entries breakdown
  const missing = report.results.filter(r => r.status === "missing_in_chart");
  
  if (missing.length > 0) {
    console.log("✗ Missing in Chart Output:\n");
    
    // Group by token symbol or protocol
    const byToken: Record<string, number> = {};
    missing.forEach(m => {
      const token = m.response_entry.token_symbol;
      byToken[token] = (byToken[token] || 0) + 1;
    });

    Object.entries(byToken)
      .sort((a, b) => b[1] - a[1])
      .forEach(([token, count]) => {
        console.log(`   • ${token}: ${count} entr${count > 1 ? "ies" : "y"}`);
      });
    
    const totalMissingValue = missing.reduce((sum, m) => sum + m.response_entry.allocated_assets, 0);
    console.log(`\n   Total value: $${totalMissingValue.toLocaleString()}\n`);
  }

  // Unmatched chart entries
  if (report.unmatched_chart_entries.length > 0) {
    console.log("📋 Chart Entries Not in Response:\n");
    
    const byProtocol: Record<string, number> = {};
    report.unmatched_chart_entries.forEach(e => {
      const key = `${e.protocol}`;
      byProtocol[key] = (byProtocol[key] || 0) + 1;
    });

    Object.entries(byProtocol).forEach(([protocol, count]) => {
      console.log(`   • ${protocol}: ${count} entr${count > 1 ? "ies" : "y"}`);
    });

    const totalUnmatchedValue = report.unmatched_chart_entries.reduce((sum, e) => sum + e.usdValue, 0);
    console.log(`\n   Total value: $${totalUnmatchedValue.toLocaleString()}\n`);
  }

  // Action items
  console.log("=".repeat(80));
  console.log("🎯 ACTION ITEMS");
  console.log("=".repeat(80) + "\n");

  if (summary.value_mismatches > 0) {
    console.log("1. Review value mismatches:");
    console.log("   - Check if idle assets are being handled consistently");
    console.log("   - Verify LP position valuation methods");
    console.log("   - Compare methodologies between systems\n");
  }

  if (summary.missing_in_chart > 0) {
    console.log("2. Fix missing chart entries:");
    console.log("   - Update allocations.ts config with correct addresses");
    console.log("   - Check PSM3 contract addresses vs token addresses");
    console.log("   - Verify Anchorage and other special allocations\n");
  }

  if (summary.chart_entries_not_in_response > 0) {
    console.log("3. Investigate unmatched chart entries:");
    console.log("   - Determine if these should be in backend response");
    console.log("   - Check if addresses match between systems");
    console.log("   - Verify if allocations are actually active\n");
  }

  if (healthScore >= 95) {
    console.log("✨ Data quality is excellent! Only minor discrepancies to review.\n");
  } else if (healthScore >= 80) {
    console.log("✓ Data quality is good. Address the issues above to improve accuracy.\n");
  } else {
    console.log("⚠️  Data quality needs attention. Focus on the major discrepancies first.\n");
  }

  console.log("📄 Full report: cli-output/5_validation_report.json");
  console.log("📖 Detailed summary: docs/validation_summary.md\n");
  
  console.log("=".repeat(80) + "\n");
}

main();
