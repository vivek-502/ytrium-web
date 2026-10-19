import { createApp } from './app.js';
import { config } from './config.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  log.info('yttrium api listening', {
    url: `http://${config.host}:${config.port}`,
    env: config.nodeEnv,
    streamMode: config.stream.mode,
    charts: config.providers.chartsEnabled,
  });
});

server.headersTimeout = 65_000;
server.requestTimeout = 0; // streaming responses may be long-lived

function shutdown(signal: string) {
  log.info('shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection', { reason: String(reason) });
});
