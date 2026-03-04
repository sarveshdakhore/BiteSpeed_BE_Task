import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../../config/env';
import { ROUTES } from '../../config/constants';
import { createIdentifyController, createSecondaryContactsController } from './identify.controller';
import type { ContactService } from './identify.service';

export function createIdentifyRouter(contactService: ContactService): Router {
  const router = Router();

  const identifyRateLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.post(ROUTES.identify, identifyRateLimiter, createIdentifyController(contactService));
  router.get(ROUTES.secondaryContacts, createSecondaryContactsController(contactService));

  return router;
}
