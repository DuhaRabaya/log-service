CREATE INDEX IF NOT EXISTS idx_logs_timestamp_id
    ON logs (timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_logs_service
    ON logs (service);

CREATE INDEX IF NOT EXISTS idx_logs_level
    ON logs (level);

CREATE INDEX IF NOT EXISTS idx_logs_attributes
    ON logs USING GIN (attributes);