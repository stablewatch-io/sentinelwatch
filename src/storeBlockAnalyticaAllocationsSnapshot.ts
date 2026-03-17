/**
 * storeBlockAnalyticaAllocationsSnapshot — daily cron Lambda
 *
 * Fetches the current allocation data from Block Analytica's Observatory API
 * and stores a timestamped snapshot in the database.
 *
 * Scheduled: cron(0 1 * * ? *)  — i.e. daily at 01:00 UTC
 */

import { getCurrentUnixTimestamp } from "./utils/date";
import { wrapScheduledLambda } from "./utils/shared/wrap";
import { db, blockAnaliticaSnapshots } from "./utils/shared/db";
import { runValidationAndStore } from "./utils/shared/runValidation";

const ENDPOINT_URL = "https://observatory.data.blockanalitica.com/allocations/?limit=200";
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;

interface BlockAnaliticaResponse {
  data: {
    results: any[];
  };
}

/**
 * Fetch data from the endpoint with exponential backoff retry logic
 */
async function fetchWithRetry(): Promise<BlockAnaliticaResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      console.log(`Attempt ${attempt + 1}/${MAX_RETRIES}: Fetching from Block Analytica...`);
      
      const response = await fetch(ENDPOINT_URL, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SentinelWatch/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as BlockAnaliticaResponse;
      
      if (!data?.data?.results || !Array.isArray(data.data.results)) {
        throw new Error("Invalid response format: missing data.results array");
      }

      console.log(`✓ Successfully fetched ${data.data.results.length} allocations`);
      return data;

    } catch (err) {
      lastError = err as Error;
      console.error(`✗ Attempt ${attempt + 1} failed:`, err);

      if (attempt < MAX_RETRIES - 1) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.log(`  Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message}`);
}

const handler = async (_event: any): Promise<void> => {
  const timestamp = getCurrentUnixTimestamp();
  console.log(`storeBlockAnalyticaAllocationsSnapshot: Starting at ${timestamp} (${new Date(timestamp * 1000).toISOString()})`);

  try {
    // Fetch data with retry logic
    const responseData = await fetchWithRetry();

    // Store to database
    await db
      .insert(blockAnaliticaSnapshots)
      .values({
        timestamp,
        responseData,
      })
      .onConflictDoUpdate({
        target: [blockAnaliticaSnapshots.timestamp],
        set: { responseData },
      });

    console.log(`✓ Stored Block Analytica allocations snapshot with ${responseData.data.results.length} allocations`);
    
    // Run validation after successfully storing snapshot
    try {
      console.log("\nRunning validation...");
      await runValidationAndStore(timestamp);
      console.log("✓ Validation completed and stored");
    } catch (validationErr) {
      console.error("✗ Validation failed (non-fatal):", validationErr);
      console.log("  Snapshot was stored successfully, but validation could not complete");
    }
    
    console.log("storeBlockAnalyticaAllocationsSnapshot: done");

  } catch (err) {
    console.error("\n" + "=".repeat(80));
    console.error("FATAL ERROR: Failed to fetch and store Block Analytica allocations snapshot");
    console.error("=".repeat(80));
    console.error("Timestamp:", timestamp);
    console.error("Error:", err);
    console.error("=".repeat(80) + "\n");
    throw err; // Re-throw to mark Lambda as failed
  }
};

export default wrapScheduledLambda(handler);
