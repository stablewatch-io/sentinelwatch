// ---------------------------------------------------------------------------
// Core domain types for SentinelWatch
// ---------------------------------------------------------------------------

/** Raw price map returned by a price-fetching adapter. */
export interface TokenPrices {
  [coinGeckoId: string]: number | null;
}

/** A single balance reading for a token on a chain. */
export interface TokenBalance {
  /**
   * Decimal-adjusted balance, stored as a full-precision string
   * (e.g. "86639871.842302") to avoid floating-point loss and JSON
   * scientific-notation serialisation (e.g. 1e-7).
   * Legacy DB rows may contain a plain number; always use parseFloat()
   * when arithmetic is required.
   */
  balance: string | number;
}

/** Balances keyed by chain name. */
export type ChainBalances = {
  [chain: string]: TokenBalance;
};

/** Generic key→value store used for JSONB data payloads. */
export type DataPayload = Record<string, any>;
