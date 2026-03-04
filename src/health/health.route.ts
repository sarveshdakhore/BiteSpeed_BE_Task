import { Router } from 'express';

import { ROUTES } from '../config/constants';
import { prisma } from '../lib/prisma';

const healthRouter = Router();

healthRouter.get(ROUTES.healthLive, (_req, res) => {
  res.status(200).json({ status: 'ok', type: 'live', timestamp: new Date().toISOString() });
});

healthRouter.get(ROUTES.healthReady, async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: 'ok', type: 'ready', timestamp: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
});

export { healthRouter };
