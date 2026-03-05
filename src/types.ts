// ---------------------------------------------------------------------------
// Core domain types for SentinelWatch
// ---------------------------------------------------------------------------

/** Raw price map returned by a price-fetching adapter. */
export interface TokenPrices {
  [coinGeckoId: string]: number | null;
}

/** A single balance reading for a token on a chain. */
export interface TokenBalance {
  /** Raw balance (already decimal-adjusted). */
  balance: number;
}

/** Balances keyed by chain name. */
export type ChainBalances = {
  [chain: string]: TokenBalance;
};

/** Generic key→value store used for JSONB data payloads. */
export type DataPayload = Record<string, any>;
