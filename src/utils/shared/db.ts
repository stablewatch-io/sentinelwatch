import { Pool } from "pg";
import sleep from "./sleep";

// Single connection pool shared across the Lambda warm container lifetime.
// Keep max small — Lambda instances are single-threaded and short-lived.
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

// ---------------------------------------------------------------------------
// Core helpers — mirror the DynamoDB PK / SK model on a single table.
//
// Schema (see schema.sql):
//   time_series(pk TEXT, sk BIGINT, data JSONB, PRIMARY KEY (pk, sk))
//
// "pk" corresponds to the DynamoDB partition key (e.g. "hourlyBalances#0").
// "sk" corresponds to the DynamoDB sort key (unix timestamp as integer).
// "data" is a JSONB blob that holds the rest of the attributes.
// ---------------------------------------------------------------------------

export interface TimeSeriesRow {
  pk: string;
  sk: number;
  data: Record<string, any>;
}

// Merge the fixed columns back into a flat object so callers see the same shape
// that DynamoDB callers expected (e.g. item.SK, item.prices, …).
function toItem(row: { pk: string; sk: string | number; data: Record<string, any> }) {
  return { PK: row.pk, SK: Number(row.sk), ...row.data };
}

const db = {
  /** Read a single row by exact PK + SK. Returns undefined if not found. */
  async get(key: { PK: string; SK: number }): Promise<Record<string, any> | undefined> {
    const res = await pool.query(
      "SELECT pk, sk, data FROM time_series WHERE pk = $1 AND sk = $2",
      [key.PK, key.SK]
    );
    if (res.rows.length === 0) return undefined;
    return toItem(res.rows[0]);
  },

  /** Upsert a row. Pass the full item including PK and SK; everything else goes into data. */
  async put(item: Record<string, any>): Promise<void> {
    const { PK, SK, ...rest } = item;
    await pool.query(
      `INSERT INTO time_series (pk, sk, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (pk, sk) DO UPDATE SET data = EXCLUDED.data`,
      [PK, SK, rest]
    );
  },

  /**
   * Query rows for a given PK with optional SK range / ordering / limit.
   * Returns an object shaped like the DynamoDB DocumentClient response:
   *   { Items: [...], LastEvaluatedKey: { SK: number } | undefined }
   *
   * Supported params (subset of DynamoDB QueryInput):
   *   ExpressionAttributeValues: { ":pk", ":sk", ":begin", ":end" }
   *   KeyConditionExpression: "PK = :pk AND SK > :sk"
   *                         | "PK = :pk AND SK >= :sk"
   *                         | "PK = :pk AND SK BETWEEN :begin AND :end"
   *   Limit: number
   *   ScanIndexForward: boolean  (false → DESC)
   */
  async query(params: {
    ExpressionAttributeValues: Record<string, any>;
    KeyConditionExpression: string;
    Limit?: number;
    ScanIndexForward?: boolean;
    ExclusiveStartKey?: { PK?: string; SK?: number };
  }): Promise<{ Items: Record<string, any>[]; LastEvaluatedKey?: { SK: number } }> {
    const ev = params.ExpressionAttributeValues;
    const pk: string = ev[":pk"];
    const desc = params.ScanIndexForward === false;
    const order = desc ? "DESC" : "ASC";
    const limit = params.Limit;

    let sqlWhere = "pk = $1";
    const sqlParams: any[] = [pk];
    let paramIdx = 2;

    const expr = params.KeyConditionExpression.toUpperCase();

    if (expr.includes("BETWEEN")) {
      const begin = ev[":begin"];
      const end = ev[":end"];
      sqlWhere += ` AND sk BETWEEN $${paramIdx} AND $${paramIdx + 1}`;
      sqlParams.push(begin, end);
      paramIdx += 2;
    } else if (expr.includes("SK >= :SK")) {
      sqlWhere += ` AND sk >= $${paramIdx}`;
      sqlParams.push(ev[":sk"]);
      paramIdx++;
    } else if (expr.includes("SK > :SK")) {
      sqlWhere += ` AND sk > $${paramIdx}`;
      sqlParams.push(ev[":sk"]);
      paramIdx++;
    }

    // ExclusiveStartKey pagination (emulate DynamoDB's LastEvaluatedKey)
    if (params.ExclusiveStartKey?.SK !== undefined) {
      const op = desc ? "<" : ">";
      sqlWhere += ` AND sk ${op} $${paramIdx}`;
      sqlParams.push(params.ExclusiveStartKey.SK);
      paramIdx++;
    }

    let sql = `SELECT pk, sk, data FROM time_series WHERE ${sqlWhere} ORDER BY sk ${order}`;
    if (limit) sql += ` LIMIT $${paramIdx}`;
    if (limit) sqlParams.push(limit + 1); // fetch one extra to detect more pages

    const res = await pool.query(sql, sqlParams);

    let rows = res.rows;
    let lastKey: { SK: number } | undefined;

    if (limit && rows.length > limit) {
      rows = rows.slice(0, limit);
      lastKey = { SK: Number(rows[rows.length - 1].sk) };
    }

    return {
      Items: rows.map(toItem),
      LastEvaluatedKey: lastKey,
    };
  },

  /** Update data fields for an existing row (merge patch). */
  async update(key: { PK: string; SK: number }, patch: Record<string, any>): Promise<void> {
    await pool.query(
      `UPDATE time_series
       SET data = data || $3::jsonb
       WHERE pk = $1 AND sk = $2`,
      [key.PK, key.SK, patch]
    );
  },

  /** Delete a single row. */
  async delete(key: { PK: string; SK: number }): Promise<void> {
    await pool.query(
      "DELETE FROM time_series WHERE pk = $1 AND sk = $2",
      [key.PK, key.SK]
    );
  },
};

export default db;

// ---------------------------------------------------------------------------
// Convenience helpers (mirror dynamodb.ts exports used across the codebase)
// ---------------------------------------------------------------------------

/** Read all rows for a PK from initialSK onwards (inclusive). */
export async function getHistoricalValues(
  pk: string,
  initialSK?: number
): Promise<Record<string, any>[]> {
  let items: Record<string, any>[] = [];
  let lastKey: number | undefined = initialSK !== undefined ? initialSK - 1 : -1;

  do {
    const result = await db.query({
      ExpressionAttributeValues: { ":pk": pk, ":sk": lastKey },
      KeyConditionExpression: "PK = :pk AND SK > :sk",
    });
    lastKey = result.LastEvaluatedKey?.SK;
    items = items.concat(result.Items);
  } while (lastKey !== undefined);

  return items;
}

const maxWriteRetries = 6;

async function underlyingBatchWrite(
  items: Array<{ PK: string; SK: number; [key: string]: any }>,
  retryCount: number,
  failOnError: boolean
): Promise<void> {
  // Postgres has no native batch-write with automatic retry semantics, so we
  // run individual upserts in a single transaction for atomicity + performance.
  const client = await pool.connect();
  const failed: typeof items = [];

  try {
    await client.query("BEGIN");
    for (const item of items) {
      try {
        const { PK, SK, ...rest } = item;
        await client.query(
          `INSERT INTO time_series (pk, sk, data)
           VALUES ($1, $2, $3)
           ON CONFLICT (pk, sk) DO UPDATE SET data = EXCLUDED.data`,
          [PK, SK, rest]
        );
      } catch (e) {
        failed.push(item);
      }
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (failed.length > 0) {
    if (retryCount < maxWriteRetries) {
      const wait = 2 ** retryCount * 10;
      const jitter = Math.random() * wait - wait / 2;
      await sleep(wait + jitter);
      return underlyingBatchWrite(failed, retryCount + 1, failOnError);
    } else if (failOnError) {
      throw new Error(`Batch write failed for ${failed.length} items after ${maxWriteRetries} retries`);
    }
  }
}

function removeDuplicateKeys(
  items: Array<{ PK: string; SK: number; [key: string]: any }>
) {
  return items.filter((item, index) =>
    items
      .slice(0, index)
      .every((checked) => !(checked.PK === item.PK && checked.SK === item.SK))
  );
}

const batchWriteStep = 25;

/** Write many items at once, deduplicating by PK+SK. */
export async function batchWrite(
  items: Array<{ PK: string; SK: number; [key: string]: any }>,
  failOnError: boolean
): Promise<void> {
  const writePromises: Promise<void>[] = [];
  for (let i = 0; i < items.length; i += batchWriteStep) {
    const chunk = removeDuplicateKeys(items.slice(i, i + batchWriteStep));
    writePromises.push(underlyingBatchWrite(chunk, 0, failOnError));
  }
  await Promise.all(writePromises);
}

/** Read many rows by (PK, SK) pairs. */
export async function batchGet(
  keys: { PK: string; SK: number }[]
): Promise<Record<string, any>[]> {
  if (keys.length === 0) return [];
  // Build: WHERE (pk, sk) IN (($1,$2), ($3,$4), ...)
  const placeholders = keys
    .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`)
    .join(", ");
  const values = keys.flatMap((k) => [k.PK, k.SK]);
  const res = await pool.query(
    `SELECT pk, sk, data FROM time_series WHERE (pk, sk) IN (${placeholders})`,
    values
  );
  return res.rows.map(toItem);
}

