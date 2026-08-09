export const sql = `
CREATE TABLE exposures (
  flag_key    TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development','production')),
  bucket_hour TIMESTAMPTZ NOT NULL,
  "value"     BOOLEAN NOT NULL,
  reason      TEXT NOT NULL,
  "count"     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (flag_key, environment, bucket_hour, "value", reason)
);
`;
