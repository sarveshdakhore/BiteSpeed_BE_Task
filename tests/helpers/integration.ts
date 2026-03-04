import { prisma } from '../../src/lib/prisma';

export const runIntegrationTests = process.env.RUN_INTEGRATION_TESTS === 'true';
export const describeIntegration = runIntegrationTests ? describe : describe.skip;

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Contact" RESTART IDENTITY CASCADE');
}
