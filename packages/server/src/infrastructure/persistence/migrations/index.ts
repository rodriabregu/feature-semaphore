import { sql as postgres001 } from './postgres/001-initial-schema.js';
import { sql as postgres002 } from './postgres/002-exposures.js';
import { sql as sqlite001 } from './sqlite/001-initial-schema.js';
import { sql as sqlite002 } from './sqlite/002-exposures.js';

export interface Migration {
  readonly version: string;
  readonly sql: string;
}

export const POSTGRES_MIGRATIONS: readonly Migration[] = [
  { version: '001-initial-schema', sql: postgres001 },
  { version: '002-exposures', sql: postgres002 },
];

export const SQLITE_MIGRATIONS: readonly Migration[] = [
  { version: '001-initial-schema', sql: sqlite001 },
  { version: '002-exposures', sql: sqlite002 },
];
