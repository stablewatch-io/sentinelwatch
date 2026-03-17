/**
 * Run database migrations
 * 
 * Applies schema changes to ensure database is up to date.
 * Safe to run multiple times - uses IF NOT EXISTS / IF EXISTS checks.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { Pool } from "pg";

async function runMigrations() {
  console.log("Running database migrations...");
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DB_SSL === "false"
        ? false
        : { rejectUnauthorized: false },
  });

  try {
    // Migration: Add idle_allocation_id column (idempotent)
    console.log("Applying: Add idle_allocation_id to allocation_balances...");
    await pool.query(`
      ALTER TABLE "allocation_balances" 
      ADD COLUMN IF NOT EXISTS "idle_allocation_id" text;
    `);
    console.log("✓ idle_allocation_id column ready");

    console.log("\n✓ All migrations applied successfully");
  } catch (err) {
    console.error("✗ Migration failed:", err);
    throw err;
  } finally {
    await pool.end();
  }
}

runMigrations();
