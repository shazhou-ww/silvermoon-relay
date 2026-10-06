PRAGMA defer_foreign_keys = ON;
PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new (id, created_at, updated_at)
SELECT id, created_at, created_at FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE TABLE external_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'github')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX external_identities_by_user
  ON external_identities (user_id, created_at);

CREATE TABLE browser_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT
);

CREATE INDEX browser_sessions_by_user
  ON browser_sessions (user_id, created_at DESC);

CREATE TABLE oauth_transactions (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'github')),
  mode TEXT NOT NULL CHECK (mode IN ('login', 'link')),
  session_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  initiator_hash TEXT NOT NULL,
  sealed_context TEXT NOT NULL,
  return_to TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE INDEX oauth_transactions_by_expiry
  ON oauth_transactions (expires_at);
CREATE INDEX oauth_transactions_by_initiator
  ON oauth_transactions (initiator_hash, expires_at);

CREATE TABLE connection_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret_hash TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  label TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'daemon:connect'
    CHECK (scope = 'daemon:connect'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  replaced_by_id TEXT REFERENCES connection_tokens(id)
);

CREATE INDEX connection_tokens_by_user
  ON connection_tokens (user_id, created_at DESC);
CREATE INDEX connection_tokens_active
  ON connection_tokens (id, revoked_at, expires_at);

ALTER TABLE daemons ADD COLUMN connection_token_id TEXT
  REFERENCES connection_tokens(id);
CREATE INDEX daemons_by_connection_token
  ON daemons (connection_token_id);

PRAGMA foreign_keys = ON;
