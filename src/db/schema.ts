import { pgTable, text, bigint, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core";

/**
 * Allocation balance snapshots (time-series per allocation)
 * 
 * Replaces the DynamoDB pattern: hourly#${id} and daily#${id}
 */
export const allocationBalances = pgTable(
  "allocation_balances",
  {
    allocationId: text("allocation_id").notNull(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    granularity: text("granularity", { enum: ["hourly", "daily"] }).notNull(),
    balanceData: jsonb("balance_data").notNull().$type<Record<string, any>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.allocationId, table.granularity, table.timestamp] }),
    timestampIdx: index("idx_allocation_balances_timestamp").on(table.timestamp.desc()),
    allocationGranularityIdx: index("idx_allocation_balances_allocation_granularity")
      .on(table.allocationId, table.granularity, table.timestamp.desc()),
  })
);

/**
 * Token prices (shared across all allocations)
 * 
 * Replaces: hourlyPrices and dailyPrices
 * prices is a map: { "<blockchain>:<address>": <usd-price> }
 */
export const tokenPrices = pgTable(
  "token_prices",
  {
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    granularity: text("granularity", { enum: ["hourly", "daily"] }).notNull(),
    prices: jsonb("prices").notNull().$type<Record<string, number>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.granularity, table.timestamp] }),
    timestampIdx: index("idx_token_prices_timestamp").on(table.timestamp.desc()),
  })
);

/**
 * Star financials (debt and reserve capital data)
 * 
 * Replaces: hourlyStarFinancials and dailyStarFinancials
 * financialsData is a map: { [starId]: { debt: string, rc: string } }
 */
export const starFinancials = pgTable(
  "star_financials",
  {
    timestamp: bigint("timestamp", { mode: "number" }).notNull(),
    granularity: text("granularity", { enum: ["hourly", "daily"] }).notNull(),
    financialsData: jsonb("financials_data").notNull().$type<Record<string, { debt: string; rc: string }>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.granularity, table.timestamp] }),
    timestampIdx: index("idx_star_financials_timestamp").on(table.timestamp.desc()),
  })
);

/**
 * Block Analitica allocations snapshots
 * 
 * Stores the raw response from the /allocations/ endpoint daily.
 * The full response data is stored as JSONB for flexible querying.
 */
export const blockAnaliticaSnapshots = pgTable(
  "block_analitica_snapshots",
  {
    timestamp: bigint("timestamp", { mode: "number" }).notNull().primaryKey(),
    responseData: jsonb("response_data").notNull().$type<{ data: { results: any[] } }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timestampIdx: index("idx_block_analitica_timestamp").on(table.timestamp.desc()),
  })
);

/**
 * Validation reports
 * 
 * Stores validation results comparing Block Analytica allocations data
 * with our internal allocation chart data.
 */
export const validationReports = pgTable(
  "validation_reports",
  {
    timestamp: bigint("timestamp", { mode: "number" }).notNull().primaryKey(),
    reportData: jsonb("report_data").notNull().$type<{
      timestamp: string;
      summary: {
        total_response_entries: number;
        matched: number;
        value_mismatches: number;
        missing_in_chart: number;
        chart_entries_not_in_response: number;
      };
      missing_in_chart: any[];
      unmatched_chart_entries: any[];
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timestampIdx: index("idx_validation_reports_timestamp").on(table.timestamp.desc()),
  })
);

// Export types for use in application code
export type AllocationBalance = typeof allocationBalances.$inferSelect;
export type NewAllocationBalance = typeof allocationBalances.$inferInsert;

export type TokenPrice = typeof tokenPrices.$inferSelect;
export type NewTokenPrice = typeof tokenPrices.$inferInsert;

export type StarFinancial = typeof starFinancials.$inferSelect;
export type NewStarFinancial = typeof starFinancials.$inferInsert;

export type BlockAnaliticaSnapshot = typeof blockAnaliticaSnapshots.$inferSelect;
export type NewBlockAnaliticaSnapshot = typeof blockAnaliticaSnapshots.$inferInsert;

export type ValidationReport = typeof validationReports.$inferSelect;
export type NewValidationReport = typeof validationReports.$inferInsert;
