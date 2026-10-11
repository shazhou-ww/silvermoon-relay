PRAGMA defer_foreign_keys = ON;
PRAGMA foreign_keys = OFF;

CREATE TABLE token_device_ambiguity_guard (
  ambiguous_count INTEGER NOT NULL
    CHECK (ambiguous_count = 0)
);

INSERT INTO token_device_ambiguity_guard (ambiguous_count)
SELECT COUNT(*)
FROM (
  SELECT user_id, connection_token_id
  FROM (
    SELECT user_id, connection_token_id, id AS connector_id
    FROM connectors
    WHERE connection_token_id IS NOT NULL
    UNION
    SELECT user_id, connection_token_id, daemon_id AS connector_id
    FROM daemon_token_bindings
  )
  GROUP BY user_id, connection_token_id
  HAVING COUNT(DISTINCT connector_id) > 1
);

DROP TABLE token_device_ambiguity_guard;

CREATE TABLE devices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id)
);

INSERT INTO devices (user_id, id, display_name, created_at)
SELECT user_id, id, display_name, created_at
FROM connectors;

INSERT INTO devices (user_id, id, display_name, created_at)
SELECT token.user_id, 'token-' || token.id, token.label, token.created_at
FROM connection_tokens AS token
WHERE NOT EXISTS (
  SELECT 1
  FROM connectors AS connector
  WHERE connector.user_id = token.user_id
    AND connector.connection_token_id = token.id
)
AND NOT EXISTS (
  SELECT 1
  FROM daemon_token_bindings AS binding
  WHERE binding.user_id = token.user_id
    AND binding.connection_token_id = token.id
);

ALTER TABLE connection_tokens ADD COLUMN device_id TEXT;

UPDATE connection_tokens AS token
SET device_id = COALESCE(
    (
      SELECT connector_id
      FROM (
        SELECT connector.id AS connector_id
        FROM connectors AS connector
        WHERE connector.user_id = token.user_id
          AND connector.connection_token_id = token.id
        UNION
        SELECT binding.daemon_id AS connector_id
        FROM daemon_token_bindings AS binding
        WHERE binding.user_id = token.user_id
          AND binding.connection_token_id = token.id
      )
      LIMIT 1
    ),
    'token-' || token.id
  );

CREATE INDEX connection_tokens_by_device
  ON connection_tokens (user_id, device_id, created_at DESC);

CREATE TRIGGER connection_tokens_require_device_insert
BEFORE INSERT ON connection_tokens
WHEN NEW.device_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM devices
  WHERE user_id = NEW.user_id AND id = NEW.device_id
)
BEGIN
  SELECT RAISE(ABORT, 'connection token requires a matching device');
END;

CREATE TRIGGER connection_tokens_require_device_update
BEFORE UPDATE OF user_id, device_id ON connection_tokens
WHEN NEW.device_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM devices
  WHERE user_id = NEW.user_id AND id = NEW.device_id
)
BEGIN
  SELECT RAISE(ABORT, 'connection token requires a matching device');
END;

CREATE TRIGGER devices_with_tokens_cannot_delete
BEFORE DELETE ON devices
WHEN EXISTS (
  SELECT 1 FROM connection_tokens
  WHERE user_id = OLD.user_id AND device_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'device has connection tokens');
END;

PRAGMA foreign_keys = ON;
