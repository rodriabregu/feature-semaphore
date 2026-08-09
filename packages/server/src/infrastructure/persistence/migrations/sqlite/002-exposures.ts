export const sql = `
CREATE TABLE exposures (
  flag_key    TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('development','production')),
  bucket_hour TEXT NOT NULL,
  "value"     INTEGER NOT NULL CHECK ("value" IN (0,1)),
  reason      TEXT NOT NULL,
  "count"     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (flag_key, environment, bucket_hour, "value", reason)
);
`;
