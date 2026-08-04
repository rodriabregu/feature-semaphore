import { sql as postgres001 } from './postgres/001-initial-schema.js';
import { sql as sqlite001 } from './sqlite/001-initial-schema.js';

export interface Migration {
  readonly version: string;
  readonly sql: string;
}

export const POSTGRES_MIGRATIONS: readonly Migration[] = [
  { version: '001-initial-schema', sql: postgres001 },
];

export const SQLITE_MIGRATIONS: readonly Migration[] = [
  { version: '001-initial-schema', sql: sqlite001 },
];
