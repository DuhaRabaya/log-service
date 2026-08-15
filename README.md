# Log Ingestion and Query Service

A service for ingesting, storing, querying, and aggregating structured application logs — built with Node.js, TypeScript, Express, and PostgreSQL.

## Setup and Usage

```bash
docker compose up
```

The service starts on `http://localhost:8080`. No configuration or manual steps are required — migrations run automatically on startup.

Check readiness:
```bash
curl http://localhost:8080/health
```

## API Documentation

### `GET /health`
Returns `200 {"status":"ok"}` once the database connection is established and migrations have been applied. Returns `503` before that point.

### `POST /logs`
Ingests a batch of log entries.

```bash
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"timestamp":"2026-08-12T10:00:00Z","level":"error","service":"checkout","message":"payment declined","attributes":{"user_id":"42"}}]}'
```

- Validates each entry independently — invalid entries are rejected individually (with array index + reason) rather than failing the whole batch.
- Returns `200` if at least one entry is accepted, `400` if all entries are rejected or the request is malformed.

### `GET /logs`
Query logs with any combination of filters: `service`, `level`, `since`, `until`, `attr.<key>`, `q` (substring match on message), `limit` (default 100, max 1000), `cursor` (opaque, from a previous response).

Results are sorted by `timestamp DESC`, with `id DESC` as a deterministic tiebreaker for same-timestamp entries. Returns `next_cursor: null` when no more results exist.

### `GET /logs/aggregate`
Time-bucketed counts. Requires `since`, `until`, `bucket` (`1m`, `5m`, `1h`, `1d`). Optional `group_by` (`service` or `level`) and the same filters as `GET /logs`. Empty buckets are omitted.

## Schema and Index Design

```sql
CREATE TABLE logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    level TEXT NOT NULL,
    service TEXT NOT NULL,
    message TEXT NOT NULL,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`BIGSERIAL` is used instead of `SERIAL` to avoid any risk of exhausting the 32-bit id space under sustained high-throughput ingestion over the service's lifetime.

**Indexes** (see `migrations/002_indexes.sql`), chosen directly from the query patterns in the API:

| Index | Supports |
|---|---|
| `(timestamp DESC, id DESC)` | The `ORDER BY` used by every query, and cursor pagination's `WHERE` clause |
| `service` (btree) | `service=` filter on `GET /logs` and `/aggregate` |
| `level` (btree) | `level=` filter |
| `attributes` (GIN) | `attr.<key>=value` filters into the JSONB column |

Verified via `EXPLAIN ANALYZE` against 234,000+ rows — the main listing query uses `Index Scan using idx_logs_timestamp_id` and executes in **0.143ms**, not a sequential scan.

## Attribute Storage Strategy

Arbitrary log attributes are stored in a `JSONB` column rather than an EAV (entity-attribute-value) table.

**Why:** attributes have no fixed schema (the spec allows arbitrary keys), so a rigid column-per-attribute design isn't viable. JSONB supports this natively, and a GIN index makes key-based lookups fast without the join overhead an EAV table would introduce at 1M+ rows. The tradeoff: querying by attribute value uses the `->>'key'` operator rather than a plain column comparison, which is slightly more verbose in the query-building code but performs well with the GIN index in place.

## Retention Strategy

Configurable via `RETENTION_DAYS` (default: 30). A background job runs every 60 seconds and deletes expired rows in batches of up to 5,000 at a time, looping within a cycle if more remain, rather than issuing one large `DELETE`.

**Why batched:** a single large `DELETE` on a huge table holds locks and creates a large burst of dead tuples (table bloat) in one transaction, which can disrupt concurrent ingestion. Small, frequent batches avoid long-running locks and keep bloat manageable, at the cost of expired data taking up to ~60 seconds (plus batch time) to be fully purged rather than disappearing instantly.

## Load-Test Methodology and Measured Results

**Test environment:** Docker Desktop on a 2018 MacBook Pro (6-core Intel i7, 16GB RAM), containers limited per the spec (app: 0.5 CPU / 256MB, Postgres: 1 CPU / 1GB).

**Method:** `scripts/load-test.ts` — 20 concurrent workers, each continuously sending batches of 500 logs via `POST /logs`, for 15 seconds.

```bash
npx tsx scripts/load-test.ts
```

**Results:**
| Metric | Result |
|---|---|
| Duration | 15.39s |
| Logs sent | 234,000 |
| Logs accepted | 234,000 |
| Errors | 0 |
| **Throughput** | **15,202 logs/sec** |

**Query performance under load** (against the 234,000 rows above):
- `GET /logs/aggregate` with `group_by=service` over a 30-day range: **0.42s** total round trip (target: <1s p95)
- `GET /logs` main listing query: **0.143ms** execution time (via `EXPLAIN ANALYZE`), confirmed using the timestamp/id index rather than a sequential scan

**Bottlenecks discovered:** none observed at this scale/duration; ingestion sustained target throughput with zero errors and zero rejections throughout the test.

**Optimizations applied:**
- Batch validation in application code before any database call, so only clean data reaches Postgres and a single multi-row `INSERT` handles an entire batch (one round trip, regardless of batch size) instead of one round trip per log entry.
- Indexes chosen to match actual query predicates and sort order (see above), rather than indexing every column.
- Connection pooling (`max: 10`) sized to avoid overwhelming Postgres's constrained single-CPU allocation.

## Known Limitations

- **`q` (substring message search)** uses `ILIKE '%...%'`, which cannot use a standard B-tree/GIN index due to the leading wildcard. At current tested scale this hasn't been a bottleneck, but at significantly larger data volumes a trigram index (`pg_trgm`) would be the next optimization.
- Load testing was run for a 15-second sustained window at 234,000 rows; longer-duration, million-row-scale testing was not performed given project time constraints.
- No authentication is implemented (see below — intentional, per the "zero configuration" contract).

## Optional Features

None implemented. `AUTH_ENABLED` and related environment variables are not used — the service is unauthenticated by default and requires no configuration to run, per the project's default-posture contract. `docker compose up` with no environment file yields the full, working service on all four required endpoints.
