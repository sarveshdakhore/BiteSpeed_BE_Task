import { buildApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';

const app = buildApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, appEnv: env.APP_ENV }, 'Server started');
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutdown signal received');

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await prisma.$disconnect();
  logger.info('Server stopped gracefully');
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void gracefulShutdown(signal).catch((error: unknown) => {
      logger.error({ err: error }, 'Error while shutting down server');
      process.exit(1);
    });
  });
}
