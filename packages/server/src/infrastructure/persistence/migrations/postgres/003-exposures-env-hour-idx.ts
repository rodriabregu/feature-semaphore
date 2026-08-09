export const sql = `
CREATE INDEX exposures_env_hour_idx ON exposures (environment, bucket_hour);
`;
