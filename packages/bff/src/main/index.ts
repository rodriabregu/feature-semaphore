import { readCompositionConfig } from './env.js';
import { startServer } from './server.js';

const config = readCompositionConfig();

const port = Number(process.env.PORT ?? '3000');
const host = process.env.HOST ?? '0.0.0.0';

startServer(config, { port, host }).catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exitCode = 1;
});
