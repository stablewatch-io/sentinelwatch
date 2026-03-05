-- ============================================================
-- Migration 1 — Initial schema
-- ============================================================
-- A single table mirrors the DynamoDB PK / SK pattern.
--   pk   — partition key  (e.g. "hourlyBalances#<allocationId>",
--                               "dailyBalances#<allocationId>",
--                               "hourlyPrices",
--                               "dailyPrices")
--   sk   — sort key       (unix timestamp, seconds)
--   data — JSONB payload  (all other attributes)
-- ============================================================

-- Up
CREATE TABLE IF NOT EXISTS time_series (
  pk   TEXT   NOT NULL,
  sk   BIGINT NOT NULL,
  data JSONB  NOT NULL DEFAULT '{}',
  PRIMARY KEY (pk, sk)
);

-- Efficient range scans for a given pk ordered by time (most common query).
CREATE INDEX IF NOT EXISTS idx_time_series_pk_sk
  ON time_series (pk, sk DESC);

