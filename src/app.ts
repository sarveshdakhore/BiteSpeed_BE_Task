import cors, { type CorsOptions } from 'cors';
import express from 'express';
import helmet from 'helmet';

import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { requestId } from './middleware/requestId';
import { requestLogger } from './middleware/requestLogger';
import { createIdentifyRouter } from './modules/identify/identify.route';
import { ContactService } from './modules/identify/identify.service';
import { healthRouter } from './health/health.route';

function buildCorsOptions(): CorsOptions {
  const exposedHeaders = ['x-request-id', 'x-identify-trace'];

  if (env.CORS_ORIGIN === '*') {
    return { origin: true, exposedHeaders };
  }

  const allowList = env.CORS_ORIGIN.split(',').map((item) => item.trim());
  return {
    origin: allowList,
    exposedHeaders,
  };
}

export function buildApp(): express.Express {
  const app = express();
  const contactService = new ContactService();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '100kb' }));
  app.use(requestId);
  app.use(requestLogger);

  app.use(healthRouter);
  app.use(createIdentifyRouter(contactService));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
