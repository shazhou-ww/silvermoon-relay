PRAGMA defer_foreign_keys = ON;
PRAGMA foreign_keys = OFF;

CREATE TABLE connector_commands_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN (
      'sessions.list',
      'session.create',
      'session.message',
      'session.history'
    )),
  session_id TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN (
      'queued',
      'sent',
      'accepted',
      'succeeded',
      'failed'
    )),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  accepted_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (user_id, connector_id)
    REFERENCES connectors(user_id, id) ON DELETE CASCADE
);

INSERT INTO connector_commands_new (
  id,
  user_id,
  connector_id,
  type,
  session_id,
  payload_json,
  status,
  error_code,
  error_message,
  created_at,
  updated_at,
  sent_at,
  accepted_at,
  completed_at
)
SELECT
  id,
  user_id,
  connector_id,
  type,
  session_id,
  payload_json,
  status,
  error_code,
  error_message,
  created_at,
  updated_at,
  sent_at,
  accepted_at,
  completed_at
FROM connector_commands;

DROP TABLE connector_commands;
ALTER TABLE connector_commands_new RENAME TO connector_commands;

CREATE INDEX connector_commands_by_connector_created
  ON connector_commands (user_id, connector_id, created_at DESC);

PRAGMA foreign_keys = ON;
