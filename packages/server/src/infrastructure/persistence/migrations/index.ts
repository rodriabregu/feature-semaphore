import { sql as postgres001 } from './postgres/001-initial-schema.js';
import { sql as postgres002 } from './postgres/002-exposures.js';
import { sql as postgres003 } from './postgres/003-exposures-env-hour-idx.js';
import { sql as sqlite001 } from './sqlite/001-initial-schema.js';
import { sql as sqlite002 } from './sqlite/002-exposures.js';
import { sql as sqlite003 } from './sqlite/003-exposures-env-hour-idx.js';

export interface Migration {
  readonly version: string;
  readonly sql: string;
}

export const POSTGRES_MIGRATIONS: readonly Migration[] = [
  { version: '001-initial-schema', sql: postgres001 },
  { version: '002-exposures', sql: postgres002 },
  { version: '003-exposures-env-hour-idx', sql: postgres003 },
];

export const SQLITE_MIGRATIONS: readonly Migration[] = [
  { version: '001-initial-schema', sql: sqlite001 },
  { version: '002-exposures', sql: sqlite002 },
  { version: '003-exposures-env-hour-idx', sql: sqlite003 },
];
