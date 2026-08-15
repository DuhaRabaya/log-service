import { pool } from "./db";

const RETENTION_DAYS = process.env.RETENTION_DAYS
  ? parseInt(process.env.RETENTION_DAYS, 10)
  : 30;

const BATCH_SIZE = 5000;
const INTERVAL_MS = 60_000; // run every 60 seconds

async function deleteBatch(): Promise<number> {
  const { rowCount } = await pool.query(
    `
    DELETE FROM logs
    WHERE id IN (
      SELECT id FROM logs
      WHERE timestamp < now() - ($1 || ' days')::interval
      LIMIT $2
    )
    `,
    [RETENTION_DAYS, BATCH_SIZE]
  );
  return rowCount ?? 0;
}

async function runRetentionCycle(): Promise<void> {
  try {
    let totalDeleted = 0;
    let deletedInBatch: number;
    do {
      deletedInBatch = await deleteBatch();
      totalDeleted += deletedInBatch;
    } while (deletedInBatch === BATCH_SIZE);

    if (totalDeleted > 0) {
      console.log(`Retention: deleted ${totalDeleted} expired log(s)`);
    }
  } catch (err) {
    console.error("Retention cycle failed:", err);
  }
}

export function startRetentionJob(): void {
  console.log(
    `Retention job started: deleting logs older than ${RETENTION_DAYS} days, every ${INTERVAL_MS / 1000}s`
  );
  setInterval(runRetentionCycle, INTERVAL_MS);
}