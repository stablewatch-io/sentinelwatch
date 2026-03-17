import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";

// Single connection pool shared across the Lambda warm container lifetime.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DB_SSL === "false"
      ? false
      : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Export the Drizzle client with schema
export const db = drizzle(pool, { schema });

// Re-export schema for convenience
export * from "../../db/schema";
