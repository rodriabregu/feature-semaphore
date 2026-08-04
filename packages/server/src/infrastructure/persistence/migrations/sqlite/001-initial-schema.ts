export const sql = `
CREATE TABLE schema_migrations (
  version    TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('admin','server')),
  environment  TEXT CHECK (environment IN ('development','production')),
  key_hash     TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  CONSTRAINT api_keys_environment_only_for_server CHECK (
    (kind = 'server' AND environment IS NOT NULL) OR
    (kind = 'admin'  AND environment IS NULL)
  )
);

CREATE TABLE flags (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE flag_configs (
  id                 TEXT PRIMARY KEY,
  flag_id            TEXT NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  environment        TEXT NOT NULL CHECK (environment IN ('development','production')),
  enabled            INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  off_value          INTEGER NOT NULL DEFAULT 0 CHECK (off_value IN (0,1)),
  on_value           INTEGER NOT NULL DEFAULT 1 CHECK (on_value IN (0,1)),
  rollout_percentage REAL NOT NULL DEFAULT 0
                     CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  salt               TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TEXT NOT NULL,
  UNIQUE (flag_id, environment)
);

CREATE TABLE targeting_rules (
  id             TEXT PRIMARY KEY,
  flag_config_id TEXT NOT NULL REFERENCES flag_configs(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 0),
  attribute      TEXT NOT NULL,
  operator       TEXT NOT NULL
                 CHECK (operator IN ('in','not_in','contains','starts_with','gt','lt')),
  "values"       TEXT NOT NULL,
  serve          INTEGER NOT NULL CHECK (serve IN (0,1)),
  rollout        REAL NOT NULL CHECK (rollout >= 0 AND rollout <= 100),
  UNIQUE (flag_config_id, position)
);

CREATE TABLE overrides (
  id             TEXT PRIMARY KEY,
  flag_config_id TEXT NOT NULL REFERENCES flag_configs(id) ON DELETE CASCADE,
  unit_id        TEXT NOT NULL,
  serve          INTEGER NOT NULL CHECK (serve IN (0,1)),
  UNIQUE (flag_config_id, unit_id)
);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  actor       TEXT NOT NULL REFERENCES api_keys(id),
  flag_key    TEXT NOT NULL,
  environment TEXT CHECK (environment IN ('development','production')),
  action      TEXT NOT NULL,
  before      TEXT,
  after       TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX audit_log_flag_created_idx ON audit_log (flag_key, created_at DESC);
`;
