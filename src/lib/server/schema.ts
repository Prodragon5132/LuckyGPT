/**
 * Database migrations. Each entry runs once, in order. Never edit an existing
 * entry after it has shipped — append a new one instead.
 *
 * Columns marked (enc) hold AES-256-GCM ciphertext produced by crypto.ts.
 * Timestamps are epoch milliseconds (BIGINT).
 */
export const MIGRATIONS: string[] = [
  `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  totp_last_step BIGINT NOT NULL DEFAULT 0,
  recovery_codes TEXT,
  prefs TEXT,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX rate_limits_key_idx ON rate_limits(key, at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX projects_user_idx ON projects(user_id);

CREATE TABLE gpts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX gpts_user_idx ON gpts(user_id);

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  gpt_id TEXT REFERENCES gpts(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  current_leaf TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX chats_user_idx ON chats(user_id, updated_at);
CREATE INDEX chats_project_idx ON chats(project_id);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  parent_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'done',
  feedback SMALLINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX messages_chat_idx ON messages(chat_id, created_at);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  text_content TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  gpt_id TEXT REFERENCES gpts(id) ON DELETE CASCADE,
  chat_id TEXT REFERENCES chats(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX files_user_idx ON files(user_id, kind, created_at);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX memories_user_idx ON memories(user_id);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX shares_user_idx ON shares(user_id)
`,
  // 2: private error log (no user ids or content; see errorlog.ts)
  `
CREATE TABLE error_logs (
  id TEXT PRIMARY KEY,
  at BIGINT NOT NULL,
  source TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX error_logs_at_idx ON error_logs(at)
`,
];
