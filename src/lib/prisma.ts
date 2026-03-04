import { PrismaClient } from '@prisma/client';

import { env } from '../config/env';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.APP_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.APP_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
