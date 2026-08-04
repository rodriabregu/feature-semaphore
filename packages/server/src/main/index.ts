import type { CompositionConfig, DatabaseDriver } from './composition-root.js';
import { startServer } from './server.js';

function readDatabaseDriver(): DatabaseDriver {
  const value = process.env.DATABASE_DRIVER ?? 'postgres';
  if (value !== 'memory' && value !== 'sqlite' && value !== 'postgres') {
    throw new Error(`Unknown DATABASE_DRIVER: ${value}`);
  }
  return value;
}

const config: CompositionConfig = {
  databaseDriver: readDatabaseDriver(),
  adminApiKey: process.env.ADMIN_API_KEY,
  databaseUrl: process.env.DATABASE_URL,
  sqliteFile: process.env.SQLITE_FILE,
};

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';

startServer(config, { port, host }).catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});
