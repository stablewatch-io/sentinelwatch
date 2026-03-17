/**
 * Helper functions for querying Block Analitica snapshots from the database
 */

import { db, blockAnaliticaSnapshots } from "./db";
import { desc } from "drizzle-orm";

/**
 * Get the most recent Block Analitica snapshot
 */
export async function getLatestBlockAnaliticaSnapshot() {
  const result = await db
    .select()
    .from(blockAnaliticaSnapshots)
    .orderBy(desc(blockAnaliticaSnapshots.timestamp))
    .limit(1);

  return result[0];
}

/**
 * Get all Block Analitica snapshots, ordered by timestamp descending
 */
export async function getAllBlockAnaliticaSnapshots() {
  return await db
    .select()
    .from(blockAnaliticaSnapshots)
    .orderBy(desc(blockAnaliticaSnapshots.timestamp));
}
