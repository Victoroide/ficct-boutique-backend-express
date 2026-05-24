import { createApp } from './app';
import { config } from './config';
import { logger } from './shared/logger';

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'ficct-docs listening');
});

function shutdown(signal: string): void {
  logger.warn({ signal }, 'shutting down');
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('forced shutdown');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
