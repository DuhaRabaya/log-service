CREATE INDEX IF NOT EXISTS idx_logs_bucket_minute
    ON logs (date_trunc('minute', timestamp AT TIME ZONE 'UTC'));

CREATE INDEX IF NOT EXISTS idx_logs_bucket_hour
    ON logs (date_trunc('hour', timestamp AT TIME ZONE 'UTC'));

CREATE INDEX IF NOT EXISTS idx_logs_bucket_day
    ON logs (date_trunc('day', timestamp AT TIME ZONE 'UTC'));