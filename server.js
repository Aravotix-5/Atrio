import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info('server_started', {
    port: config.port,
    env: config.isProduction ? 'production' : 'development',
    url: config.appUrl,
    stripe: config.stripe.configured ? 'configured' : 'not configured',
  });
});

function shutdown(signal) {
  logger.info('shutting_down', { signal });
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_rejection', { message: reason?.message || String(reason) });
});
