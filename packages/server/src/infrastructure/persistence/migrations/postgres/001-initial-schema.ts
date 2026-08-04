export const sql = `
CREATE TABLE schema_migrations (
  version    TEXT PRIMARY KEY,
  checksum   TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE api_keys (
  id           UUID PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('admin','server')),
  environment  TEXT CHECK (environment IN ('development','production')),
  key_hash     CHAR(64) NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  CONSTRAINT api_keys_environment_only_for_server CHECK (
    (kind = 'server' AND environment IS NOT NULL) OR
    (kind = 'admin'  AND environment IS NULL)
  )
);

CREATE TABLE flags (
  id          UUID PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE flag_configs (
  id                 UUID PRIMARY KEY,
  flag_id            UUID NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  environment        TEXT NOT NULL CHECK (environment IN ('development','production')),
  enabled            BOOLEAN NOT NULL DEFAULT false,
  off_value          BOOLEAN NOT NULL DEFAULT false,
  on_value           BOOLEAN NOT NULL DEFAULT true,
  rollout_percentage NUMERIC(5,2) NOT NULL DEFAULT 0
                     CHECK (rollout_percentage >= 0 AND rollout_percentage <= 100),
  salt               TEXT NOT NULL,
  version            INTEGER NOT NULL DEFAULT 1,
  updated_at         TIMESTAMPTZ NOT NULL,
  UNIQUE (flag_id, environment)
);

CREATE TABLE targeting_rules (
  id             UUID PRIMARY KEY,
  flag_config_id UUID NOT NULL REFERENCES flag_configs(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL CHECK (position >= 0),
  attribute      TEXT NOT NULL,
  operator       TEXT NOT NULL
                 CHECK (operator IN ('in','not_in','contains','starts_with','gt','lt')),
  "values"       JSONB NOT NULL,
  serve          BOOLEAN NOT NULL,
  rollout        NUMERIC(5,2) NOT NULL CHECK (rollout >= 0 AND rollout <= 100),
  UNIQUE (flag_config_id, position)
);

CREATE TABLE overrides (
  id             UUID PRIMARY KEY,
  flag_config_id UUID NOT NULL REFERENCES flag_configs(id) ON DELETE CASCADE,
  unit_id        TEXT NOT NULL,
  serve          BOOLEAN NOT NULL,
  UNIQUE (flag_config_id, unit_id)
);

CREATE TABLE audit_log (
  id          UUID PRIMARY KEY,
  actor       UUID NOT NULL REFERENCES api_keys(id),
  flag_key    TEXT NOT NULL,
  environment TEXT CHECK (environment IN ('development','production')),
  action      TEXT NOT NULL,
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX audit_log_flag_created_idx ON audit_log (flag_key, created_at DESC);
`;
