import { Router } from "express";
import { pool } from "../db";
import { validateLogEntry, ValidatedLogEntry } from "../validation/logEntry";
import { Request, Response } from "express";

export const logsRouter = Router();

logsRouter.post("/logs", async (req, res) => {
  const body = req.body;

  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray(body.logs)
  ) {
    return res.status(400).json({ error: "request body must be an object with a 'logs' array" });
  }

  const rawLogs: unknown[] = body.logs;

  const validEntries: ValidatedLogEntry[] = [];
  const rejected: { index: number; reason: string }[] = [];

  rawLogs.forEach((raw, index) => {
    const result = validateLogEntry(raw);
    if (result.valid) {
      validEntries.push(result.entry);
    } else {
      rejected.push({ index, reason: result.reason });
    }
  });

  if (validEntries.length === 0) {
    return res.status(400).json({
      accepted: 0,
      rejected,
    });
  }

  await insertLogs(validEntries);

  res.status(200).json({
    accepted: validEntries.length,
    rejected,
  });
});

async function insertLogs(entries: ValidatedLogEntry[]): Promise<void> {
  const values: unknown[] = [];
  const rowPlaceholders: string[] = [];

  entries.forEach((entry, i) => {
    const base = i * 5;
    rowPlaceholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
    );
    values.push(
      entry.timestamp,
      entry.level,
      entry.service,
      entry.message,
      JSON.stringify(entry.attributes)
    );
  });

  const sql = `
    INSERT INTO logs (timestamp, level, service, message, attributes)
    VALUES ${rowPlaceholders.join(", ")}
  `;

  await pool.query(sql, values);
}

const VALID_LEVELS = ["debug", "info", "warn", "error"];

interface Cursor {
  timestamp: string;
  id: string;
}

function encodeCursor(timestamp: string, id: number): string {
  return Buffer.from(JSON.stringify({ timestamp, id })).toString("base64");
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    if (
      typeof decoded === "object" &&
      decoded !== null &&
      typeof decoded.timestamp === "string" &&
      typeof decoded.id === "string"
    ) {
      return decoded;
    }
    return null;
  } catch {
    return null;
  }
}

logsRouter.get("/logs", async (req: Request, res: Response) => {
  const {
    service,
    level,
    since,
    until,
    q,
    limit: limitRaw,
    cursor: cursorRaw,
  } = req.query;

  // Validate level
  if (level !== undefined && !VALID_LEVELS.includes(level as string)) {
    return res.status(400).json({ error: `invalid level: '${level}'` });
  }

  // Validate since/until
  let sinceDate: Date | undefined;
  let untilDate: Date | undefined;
  if (since !== undefined) {
    sinceDate = new Date(since as string);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({ error: `invalid since timestamp: '${since}'` });
    }
  }
  if (until !== undefined) {
    untilDate = new Date(until as string);
    if (isNaN(untilDate.getTime())) {
      return res.status(400).json({ error: `invalid until timestamp: '${until}'` });
    }
  }
  if (sinceDate && untilDate && untilDate.getTime() < sinceDate.getTime()) {
    return res.status(400).json({ error: "until must not be earlier than since" });
  }

  // Validate limit
  let limit = 100;
  if (limitRaw !== undefined) {
    limit = parseInt(limitRaw as string, 10);
    if (isNaN(limit) || String(limit) !== String(limitRaw) || limit < 1 || limit > 1000) {
      return res.status(400).json({ error: `invalid limit: '${limitRaw}'` });
    }
  }

  // Validate cursor
  let cursor: Cursor | null = null;
  if (cursorRaw !== undefined) {
    cursor = decodeCursor(cursorRaw as string);
    if (cursor === null) {
      return res.status(400).json({ error: "invalid cursor" });
    }
  }

  // Collect attr.<key> filters
  const attrFilters: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("attr.") && typeof value === "string") {
      attrFilters.push({ key: key.slice(5), value });
    }
  }

  // Build WHERE clause dynamically
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (service !== undefined) {
    params.push(service);
    conditions.push(`service = $${params.length}`);
  }
  if (level !== undefined) {
    params.push(level);
    conditions.push(`level = $${params.length}`);
  }
  if (sinceDate) {
    params.push(sinceDate.toISOString());
    conditions.push(`timestamp >= $${params.length}`);
  }
  if (untilDate) {
    params.push(untilDate.toISOString());
    conditions.push(`timestamp < $${params.length}`);
  }
  if (q !== undefined) {
    params.push(`%${q}%`);
    conditions.push(`message ILIKE $${params.length}`);
  }
  for (const { key, value } of attrFilters) {
  params.push(JSON.stringify({ [key]: value }));
  conditions.push(`attributes @> $${params.length}::jsonb`);
}
  if (cursor) {
    params.push(cursor.timestamp);
    const tsParam = params.length;
    params.push(cursor.id);
    const idParam = params.length;
    conditions.push(
      `(timestamp < $${tsParam} OR (timestamp = $${tsParam} AND id < $${idParam}))`
    );
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Fetch limit+1 to know if there's a next page
  params.push(limit + 1);
  const limitParam = params.length;

  const sql = `
    SELECT id, timestamp, level, service, message, attributes
    FROM logs
    ${whereClause}
    ORDER BY timestamp DESC, id DESC
    LIMIT $${limitParam}
  `;

  const { rows } = await pool.query(sql, params);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  const logs = pageRows.map((row) => ({
    id: String(row.id),
    timestamp: row.timestamp.toISOString(),
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: row.attributes,
  }));

  const next_cursor = hasMore
    ? encodeCursor(
        pageRows[pageRows.length - 1].timestamp.toISOString(),
        pageRows[pageRows.length - 1].id
      )
    : null;

  res.status(200).json({ logs, next_cursor });
});

//////////////////////////////////////

const BUCKET_SECONDS: Record<string, number> = {
  "1m": 60,
  "5m": 300,
  "1h": 3600,
  "1d": 86400,
};

logsRouter.get("/logs/aggregate", async (req: Request, res: Response) => {
  const { service, level, since, until, bucket, group_by, q } = req.query;

  if (since === undefined || until === undefined || bucket === undefined) {
    return res.status(400).json({ error: "since, until, and bucket are required" });
  }

  const sinceDate = new Date(since as string);
  if (isNaN(sinceDate.getTime())) {
    return res.status(400).json({ error: `invalid since timestamp: '${since}'` });
  }
  const untilDate = new Date(until as string);
  if (isNaN(untilDate.getTime())) {
    return res.status(400).json({ error: `invalid until timestamp: '${until}'` });
  }
  if (untilDate.getTime() < sinceDate.getTime()) {
    return res.status(400).json({ error: "until must not be earlier than since" });
  }

  const bucketSeconds = BUCKET_SECONDS[bucket as string];
  if (bucketSeconds === undefined) {
    return res.status(400).json({ error: `invalid bucket: '${bucket}'. Must be one of 1m, 5m, 1h, 1d` });
  }

  if (level !== undefined && !["debug", "info", "warn", "error"].includes(level as string)) {
    return res.status(400).json({ error: `invalid level: '${level}'` });
  }

  let groupColumn: string | null = null;
  if (group_by !== undefined) {
    if (group_by !== "service" && group_by !== "level") {
      return res.status(400).json({ error: `invalid group_by: '${group_by}'. Must be service or level` });
    }
    groupColumn = group_by as string;
  }

  const attrFilters: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("attr.") && typeof value === "string") {
      attrFilters.push({ key: key.slice(5), value });
    }
  }

  const conditions: string[] = ["timestamp >= $1", "timestamp < $2"];
  const params: unknown[] = [sinceDate.toISOString(), untilDate.toISOString()];

  if (service !== undefined) {
    params.push(service);
    conditions.push(`service = $${params.length}`);
  }
  if (level !== undefined) {
    params.push(level);
    conditions.push(`level = $${params.length}`);
  }
  if (q !== undefined) {
    params.push(`%${q}%`);
    conditions.push(`message ILIKE $${params.length}`);
  }
  for (const { key, value } of attrFilters) {
  params.push(JSON.stringify({ [key]: value }));
  conditions.push(`attributes @> $${params.length}::jsonb`);
}

  const DATE_TRUNC_UNIT: Record<string, string> = {
  "1m": "minute",
  "1h": "hour",
  "1d": "day",
};

const truncUnit = DATE_TRUNC_UNIT[bucket as string];
const bucketExpr = truncUnit
  ? `date_trunc('${truncUnit}', timestamp AT TIME ZONE 'UTC')`
  : `to_timestamp(floor(extract(epoch from timestamp) / 300) * 300)`;

  const selectGroup = groupColumn ? groupColumn : "NULL";
  const groupByClause = groupColumn ? `${bucketExpr}, ${groupColumn}` : bucketExpr;

  const sql = `
    SELECT
      ${bucketExpr} AS bucket_start,
      ${selectGroup} AS group_value,
      COUNT(*) AS count
    FROM logs
    WHERE ${conditions.join(" AND ")}
    GROUP BY ${groupByClause}
    ORDER BY bucket_start ASC
  `;

  const { rows } = await pool.query(sql, params);

  const buckets = rows.map((row) => ({
    start: row.bucket_start.toISOString(),
    group: row.group_value,
    count: parseInt(row.count, 10),
  }));

  res.status(200).json({ buckets });
});