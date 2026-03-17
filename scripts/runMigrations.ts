/**
 * Run Drizzle migrations
 * 
 * Applies all pending migrations from the drizzle/ folder to the database.
 * Used during deployment to ensure schema is up to date.
 */

import * as dotenv from "dotenv";
dotenv.config();

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function runMigrations() {
  console.log("Running Drizzle migrations...");
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DB_SSL === "false"
        ? false
        : { rejectUnauthorized: false },
  });

  const db = drizzle(pool);

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("✓ Migrations applied successfully");
  } catch (err) {
    console.error("✗ Migration failed:", err);
    throw err;
  } finally {
    await pool.end();
  }
}

runMigrations();
