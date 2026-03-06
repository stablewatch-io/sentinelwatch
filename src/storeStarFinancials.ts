/**
 * storeStarFinancials — hourly cron job
 *
 * For each active Star:
 *   - debt  — total DAI debt from the MakerDAO Vat (Art * rate / RAY)
 *   - rc   — USDS balance held by the star's subproxy contract
 *
 * One combined row is written per hour (all stars in a single DB item).
 * A complementary daily row is written if no daily record yet exists for today.
 */
import { wrapScheduledLambda } from "./utils/shared/wrap";
import {
  getCurrentUnixTimestamp,
  getDay,
  getTimestampAtStartOfDay,
  secondsInDay,
} from "./utils/date";
import db from "./utils/shared/db";
import getRecordClosestToTimestamp from "./utils/shared/getRecordClosestToTimestamp";
import {
  hourlyStarFinancials,
  dailyStarFinancials,
} from "./peggedAssets/utils/getLastRecord";
import { stars } from "./starData/stars";
import { getProvider } from "./utils/providers";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// Contract addresses & ABIs
// ---------------------------------------------------------------------------

const VAT_ADDRESS = "0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B";
const VAT_ABI = [
  "function ilks(bytes32 ilk) view returns (uint256 Art, uint256 rate, uint256 spot, uint256 line, uint256 dust)",
];

/** USDS token — used for the rc balance check against each subproxy. */
const USDS_ADDRESS = "0xdC035D45d973E3EC169d2276DDab16f1e407384F";
const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const RAY = 10n ** 27n;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

const handler = async (_event: any): Promise<void> => {
  const timestamp = getCurrentUnixTimestamp();
  const daySK = getTimestampAtStartOfDay(timestamp);

  const provider = getProvider("ethereum");
  const vat = new ethers.Contract(VAT_ADDRESS, VAT_ABI, provider);
  const usds = new ethers.Contract(USDS_ADDRESS, ERC20_ABI, provider);

  const usdsDecimals = Number(await usds.decimals());

  const activeStars = stars.filter((s) => !s.skip);
  console.log(
    `storeStarFinancials: fetching data for ${activeStars.length} stars at ${timestamp}`
  );

  // Collect financials for all active stars into a single DB item.
  const data: Record<
    string,
    { debt: string; rc: string }
  > = {};

  for (const star of activeStars) {
    try {
      // ── Debt ─────────────────────────────────────────────────────────────
      const ilkData = await vat.ilks(star.ilk);
      const Art: bigint = ilkData.Art;
      const rate: bigint = ilkData.rate;
      const debtRaw: bigint = (Art * rate) / RAY;
      const debt = ethers.formatUnits(debtRaw, 18);

      // ── rc (USDS balance in subproxy) ────────────────────────────────────
      const [, subproxyAddress] = star.subproxy.split(":");
      const rcRaw: bigint = await usds.balanceOf(subproxyAddress);
      const rc = ethers.formatUnits(rcRaw, usdsDecimals);

      console.log(
        `storeStarFinancials: [${star.name}] debt=${debt} rc=${rc}`
      );

      data[star.id] = { debt, rc };
    } catch (err) {
      console.error(
        `storeStarFinancials: failed to fetch data for ${star.name}:`,
        err
      );
    }
  }

  // ── Write hourly record ──────────────────────────────────────────────────
  await db.put({
    PK: hourlyStarFinancials,
    SK: timestamp,
    data,
  });

  // ── Write daily record (first write of the day only) ────────────────────
  const closestDaily = await getRecordClosestToTimestamp(
    dailyStarFinancials,
    timestamp,
    secondsInDay * 1.5
  );

  if (getDay(closestDaily?.SK) !== getDay(timestamp)) {
    await db.put({
      PK: dailyStarFinancials,
      SK: daySK,
      data,
    });
    console.log(
      `storeStarFinancials: wrote daily record for ${new Date(
        daySK * 1000
      )
        .toISOString()
        .slice(0, 10)}`
    );
  }

  console.log("storeStarFinancials: done");
};

export default wrapScheduledLambda(handler);



