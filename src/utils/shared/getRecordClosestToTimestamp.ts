import db from "./db";

export default async function getRecordClosestToTimestamp(
  PK: string,
  timestamp: number,
  searchWidth: number
): Promise<Record<string, any>> {
  const result = await db.query({
    ExpressionAttributeValues: {
      ":pk": PK,
      ":begin": timestamp - searchWidth,
      ":end": timestamp + searchWidth,
    },
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :begin AND :end",
  });

  const items = result.Items;

  if (!items || items.length === 0) {
    return { SK: undefined };
  }

  let closest = items[0];
  for (const item of items.slice(1)) {
    if (Math.abs(item.SK - timestamp) < Math.abs(closest.SK - timestamp)) {
      closest = item;
    }
  }
  return closest;
}
