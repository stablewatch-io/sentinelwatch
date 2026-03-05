import { getTimestampAtStartOfDay } from "../../utils/date";
import db from "../../utils/shared/db";

type AnyRecord = Record<string, unknown>;

type HourlyDoc = {
  PK: string;
  SK: number;
} & AnyRecord;

type DailyKey = { PK: string; SK: number };

type PromoteResult = {
  action: "PROMOTE";
  reason: string;
  key?: DailyKey;
  preview?: { Key: DailyKey; Item: HourlyDoc };
  isReplacement?: boolean;
};

type SkipResult = {
  action: "SKIP";
  reason: string;
  preview?: { Key: DailyKey };
};

type ReconcileResult = PromoteResult | SkipResult;

// ---------------------------------------------------------------------------
// Quality scoring — prefer a real reading over no reading.
// Subclasses can extend this logic; the default is "any row beats no row".
// ---------------------------------------------------------------------------

function shouldPromote(
  existingDaily: HourlyDoc | undefined,
  _incomingHourly: HourlyDoc
): boolean {
  return existingDaily === undefined;
}

function explainDecision(
  existingDaily: HourlyDoc | undefined,
  _incoming: HourlyDoc
): string {
  if (!existingDaily) return "No existing daily → promote.";
  return "Daily already exists for this day → keep.";
}

function buildDailyFromHourly(hourly: HourlyDoc, daySK: number): HourlyDoc {
  return { ...hourly, SK: daySK };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Given a freshly-written hourly record, decide whether it should be promoted
 * to the daily table for that day.  Pass `opts.dryRun = true` to preview the
 * outcome without touching the DB.
 */
export async function reconcileDailyFromHourly(
  incomingHourly: HourlyDoc,
  dailyPKBuilder: (id: string) => string,
  entityId: string,
  opts?: {
    dryRun?: boolean;
    existingDailyOverride?: HourlyDoc;
  }
): Promise<ReconcileResult> {
  const daySK = getTimestampAtStartOfDay(incomingHourly.SK);
  const dailyPK = dailyPKBuilder(entityId);
  const dailyKey: DailyKey = { PK: dailyPK, SK: daySK };

  let existingDaily: HourlyDoc | undefined;
  if (opts?.dryRun) {
    existingDaily = opts.existingDailyOverride;
  } else {
    existingDaily = (await db.get(dailyKey)) as HourlyDoc | undefined;
  }

  const promote = shouldPromote(existingDaily, incomingHourly);
  const reason = explainDecision(existingDaily, incomingHourly);
  const isReplacement = promote && existingDaily !== undefined;
  const toWrite = promote ? buildDailyFromHourly(incomingHourly, daySK) : undefined;

  if (opts?.dryRun) {
    const previewItem = toWrite ? { ...toWrite, PK: dailyPK, SK: daySK } : undefined;
    return promote
      ? {
          action: "PROMOTE",
          reason,
          preview: { Key: dailyKey, Item: previewItem! },
          isReplacement,
        }
      : {
          action: "SKIP",
          reason,
          preview: { Key: dailyKey },
        };
  }

  if (!promote || !toWrite) {
    return { action: "SKIP", reason };
  }

  await db.put({ ...toWrite, PK: dailyPK, SK: daySK });

  return { action: "PROMOTE", reason, key: dailyKey, isReplacement };
}
