CREATE TABLE daemon_token_bindings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_token_id TEXT NOT NULL REFERENCES connection_tokens(id) ON DELETE CASCADE,
  daemon_id TEXT NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, connection_token_id, daemon_id)
);

CREATE INDEX daemon_token_bindings_by_token
  ON daemon_token_bindings (user_id, connection_token_id);
