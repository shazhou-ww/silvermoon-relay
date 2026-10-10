PRAGMA foreign_keys = ON;

CREATE TABLE connectors (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  agent_name TEXT,
  agent_version TEXT,
  capabilities_json TEXT NOT NULL DEFAULT
    '{"listSessions":false,"createSession":false,"sendMessage":false,"streamEvents":false}',
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline')),
  connection_token_id TEXT REFERENCES connection_tokens(id),
  connected_at TEXT,
  disconnected_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX connectors_by_user_status
  ON connectors (user_id, status, last_seen_at DESC);
CREATE INDEX connectors_by_connection_token
  ON connectors (user_id, connection_token_id);

INSERT INTO connectors (
  user_id,
  id,
  display_name,
  agent_name,
  capabilities_json,
  status,
  connection_token_id,
  last_seen_at,
  created_at
)
SELECT
  user_id,
  id,
  COALESCE(display_name, id),
  'Legacy daemon',
  '{"listSessions":false,"createSession":false,"sendMessage":false,"streamEvents":false}',
  'offline',
  connection_token_id,
  last_seen_at,
  created_at
FROM daemons;

CREATE TABLE agent_sessions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL
    CHECK (status IN (
      'queued',
      'running',
      'waiting',
      'idle',
      'failed',
      'closed',
      'gone',
      'unknown'
    )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  last_message_preview TEXT,
  PRIMARY KEY (user_id, connector_id, id),
  FOREIGN KEY (user_id, connector_id)
    REFERENCES connectors(user_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_sessions_by_connector_activity
  ON agent_sessions (user_id, connector_id, last_activity_at DESC);

CREATE TABLE agent_session_events (
  user_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  type TEXT NOT NULL
    CHECK (type IN ('message', 'activity', 'tool', 'status', 'error')),
  role TEXT CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT,
  data_json TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, connector_id, session_id, event_id),
  UNIQUE (user_id, connector_id, session_id, sequence),
  FOREIGN KEY (user_id, connector_id, session_id)
    REFERENCES agent_sessions(user_id, connector_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_session_events_by_sequence
  ON agent_session_events (
    user_id,
    connector_id,
    session_id,
    sequence
  );

CREATE TABLE connector_commands (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('sessions.list', 'session.create', 'session.message')),
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

CREATE INDEX connector_commands_by_connector_created
  ON connector_commands (user_id, connector_id, created_at DESC);
