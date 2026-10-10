ALTER TABLE agent_sessions ADD COLUMN parent_session_id TEXT;

ALTER TABLE agent_sessions ADD COLUMN can_send_message INTEGER NOT NULL
  DEFAULT 1 CHECK (can_send_message IN (0, 1));

CREATE INDEX agent_sessions_by_parent_activity
  ON agent_sessions (
    user_id,
    connector_id,
    parent_session_id,
    last_activity_at DESC
  );
