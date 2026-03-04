import {
  LinkPrecedence,
  Prisma,
  type Contact,
  type PrismaClient,
  type Prisma as PrismaNamespace,
} from '@prisma/client';

import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import type {
  IdentifyInput,
  IdentifyRequestContext,
  IdentifyResult,
  SecondaryContactsResult,
  IdentifyTrace,
  IdentifyTraceResult,
  MatchStrategy,
  NormalizedIdentifyInput,
} from './identify.types';
import { mapContactsToIdentifyResult } from './identify.mapper';

export function normalizeEmail(email?: string): string | undefined {
  if (!email) {
    return undefined;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizePhoneNumber(phoneNumber?: string): string | undefined {
  if (!phoneNumber) {
    return undefined;
  }

  const normalized = phoneNumber.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function aggressiveNormalizePhoneNumber(phoneNumber?: string): string | undefined {
  if (!phoneNumber) {
    return undefined;
  }

  const normalized = phoneNumber.replace(/[^0-9]/g, '');
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeIdentifyInput(input: IdentifyInput): NormalizedIdentifyInput {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);

  return {
    email: normalizeEmail(input.email),
    phoneNumber,
    aggressivePhoneNumber: aggressiveNormalizePhoneNumber(phoneNumber),
  };
}

export function choosePrimaryContact(primaries: Contact[]): Contact {
  if (primaries.length === 0) {
    throw new Error('Cannot choose primary from an empty list');
  }

  const winner = [...primaries].sort((a, b) => {
    const createdAtSort = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdAtSort !== 0) {
      return createdAtSort;
    }
    return a.id - b.id;
  })[0];

  if (!winner) {
    throw new Error('Unable to choose a primary contact');
  }

  return winner;
}

function arePhoneNumbersEquivalent(existing?: string | null, incoming?: string): boolean {
  if (!existing || !incoming) {
    return false;
  }

  if (existing === incoming) {
    return true;
  }

  const existingAggressive = aggressiveNormalizePhoneNumber(existing);
  const incomingAggressive = aggressiveNormalizePhoneNumber(incoming);

  return (
    typeof existingAggressive === 'string' &&
    typeof incomingAggressive === 'string' &&
    existingAggressive === incomingAggressive
  );
}

const FLOW_EDGE_IDS = {
  requestToSafeMatch: 'E01',
  safeNoToFallback: 'E02',
  fallbackNoToCreatePrimary: 'E03',
  fallbackYesToResolvePrimaries: 'E04',
  safeYesToResolvePrimaries: 'E05',
  resolveToMultiPrimaryDecision: 'E06',
  multiPrimaryYesToKeepOldest: 'E07',
  keepOldestToDemoteNewer: 'E08',
  demoteToReparent: 'E09',
  multiPrimaryNoToUseExisting: 'E10',
  reparentToNewDataDecision: 'E11',
  useExistingToNewDataDecision: 'E12',
  newDataYesToCreateSecondary: 'E13',
  newDataNoToNoNewRow: 'E14',
  createSecondaryToReturn: 'E15',
  noNewRowToReturn: 'E16',
  createPrimaryToReturn: 'E17',
} as const;

const MAX_IDENTIFY_TRANSACTION_RETRIES = 3;
const TRANSACTION_RETRY_DELAY_MS = 20;

function buildTraceEdgePath(
  strategy: MatchStrategy,
  mergedPrimaries: boolean,
  createdSecondary: boolean,
): string[] {
  const path: string[] = [FLOW_EDGE_IDS.requestToSafeMatch];

  if (strategy === 'no_match') {
    path.push(
      FLOW_EDGE_IDS.safeNoToFallback,
      FLOW_EDGE_IDS.fallbackNoToCreatePrimary,
      FLOW_EDGE_IDS.createPrimaryToReturn,
    );
    return path;
  }

  if (strategy === 'fallback') {
    path.push(FLOW_EDGE_IDS.safeNoToFallback, FLOW_EDGE_IDS.fallbackYesToResolvePrimaries);
  } else {
    path.push(FLOW_EDGE_IDS.safeYesToResolvePrimaries);
  }

  path.push(FLOW_EDGE_IDS.resolveToMultiPrimaryDecision);

  if (mergedPrimaries) {
    path.push(
      FLOW_EDGE_IDS.multiPrimaryYesToKeepOldest,
      FLOW_EDGE_IDS.keepOldestToDemoteNewer,
      FLOW_EDGE_IDS.demoteToReparent,
      FLOW_EDGE_IDS.reparentToNewDataDecision,
    );
  } else {
    path.push(FLOW_EDGE_IDS.multiPrimaryNoToUseExisting, FLOW_EDGE_IDS.useExistingToNewDataDecision);
  }

  if (createdSecondary) {
    path.push(FLOW_EDGE_IDS.newDataYesToCreateSecondary, FLOW_EDGE_IDS.createSecondaryToReturn);
  } else {
    path.push(FLOW_EDGE_IDS.newDataNoToNoNewRow, FLOW_EDGE_IDS.noNewRowToReturn);
  }

  return path;
}

export class ContactService {
  constructor(private readonly prismaClient: PrismaClient = prisma) {}

  async identify(input: IdentifyInput, context?: IdentifyRequestContext): Promise<IdentifyResult> {
    const { result } = await this.identifyInternal(input, context);
    return result;
  }

  async getSecondaryContacts(primaryContactId: number): Promise<SecondaryContactsResult> {
    const existingContact = await this.prismaClient.contact.findFirst({
      where: {
        id: primaryContactId,
        deletedAt: null,
      },
    });

    if (!existingContact) {
      return {
        found: false,
        primaryContactId,
        secondaryContacts: [],
      };
    }

    const resolvedPrimaryContactId =
      existingContact.linkPrecedence === LinkPrecedence.secondary && existingContact.linkedId
        ? existingContact.linkedId
        : existingContact.id;

    const secondaryContacts = await this.prismaClient.contact.findMany({
      where: {
        deletedAt: null,
        linkedId: resolvedPrimaryContactId,
        linkPrecedence: LinkPrecedence.secondary,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return {
      found: true,
      primaryContactId: resolvedPrimaryContactId,
      secondaryContacts: secondaryContacts.map((contact) => ({
        id: contact.id,
        phoneNumber: contact.phoneNumber,
        email: contact.email,
        linkedId: contact.linkedId,
        linkPrecedence: contact.linkPrecedence,
        createdAt: contact.createdAt.toISOString(),
        updatedAt: contact.updatedAt.toISOString(),
      })),
    };
  }

  async identifyWithTrace(
    input: IdentifyInput,
    context?: IdentifyRequestContext,
  ): Promise<IdentifyTraceResult> {
    return this.identifyInternal(input, context);
  }

  private async identifyInternal(
    input: IdentifyInput,
    context?: IdentifyRequestContext,
  ): Promise<IdentifyTraceResult> {
    const normalized = normalizeIdentifyInput(input);

    logger.info(
      {
        requestId: context?.requestId,
        action: 'identify_request',
        rawInput: input,
        normalizedInput: normalized,
      },
      'Processing identify request',
    );

    for (let attempt = 1; attempt <= MAX_IDENTIFY_TRANSACTION_RETRIES; attempt += 1) {
      const traceState = {
        strategy: 'no_match' as MatchStrategy,
        matchedInitially: false,
        mergedPrimaries: false,
        createdPrimary: false,
        createdSecondary: false,
      };

      try {
        const result = await this.prismaClient.$transaction(
          async (tx) => {
            await this.acquireIdentifierLocks(tx, normalized);

            let { contacts: matchedContacts, strategy } = await this.findMatches(tx, normalized);
            traceState.strategy = strategy;
            traceState.matchedInitially = matchedContacts.length > 0;

            if (matchedContacts.length === 0) {
              const createdPrimary = await tx.contact.create({
                data: {
                  email: normalized.email,
                  phoneNumber: normalized.phoneNumber,
                  linkPrecedence: LinkPrecedence.primary,
                },
              });
              traceState.createdPrimary = true;

              logger.info(
                {
                  requestId: context?.requestId,
                  strategy,
                  action: 'create_primary',
                  primaryContactId: createdPrimary.id,
                },
                'Created brand new primary contact',
              );

              return mapContactsToIdentifyResult([createdPrimary], createdPrimary.id);
            }

            const roots = await this.resolveRootPrimaries(tx, matchedContacts);
            const distinctPrimaries = Array.from(roots.values());
            let truePrimary = choosePrimaryContact(distinctPrimaries);

            if (distinctPrimaries.length > 1) {
              traceState.mergedPrimaries = true;
              const loserPrimaryIds = distinctPrimaries
                .filter((primary) => primary.id !== truePrimary.id)
                .map((primary) => primary.id);

              await tx.contact.updateMany({
                where: {
                  linkedId: { in: loserPrimaryIds },
                  linkPrecedence: LinkPrecedence.secondary,
                  deletedAt: null,
                },
                data: {
                  linkedId: truePrimary.id,
                },
              });

              await tx.contact.updateMany({
                where: {
                  id: { in: loserPrimaryIds },
                  deletedAt: null,
                },
                data: {
                  linkPrecedence: LinkPrecedence.secondary,
                  linkedId: truePrimary.id,
                },
              });

              truePrimary = await tx.contact.findUniqueOrThrow({ where: { id: truePrimary.id } });

              logger.info(
                {
                  requestId: context?.requestId,
                  strategy,
                  action: 'merge_primaries',
                  truePrimaryId: truePrimary.id,
                  demotedPrimaryIds: loserPrimaryIds,
                },
                'Merged multiple primaries into single true primary',
              );
            }

            let clusterContacts = await this.fetchCluster(tx, truePrimary.id);

            const emailExists =
              typeof normalized.email === 'string' &&
              clusterContacts.some((contact) => contact.email === normalized.email);

            const phoneExists =
              typeof normalized.phoneNumber === 'string' &&
              clusterContacts.some((contact) =>
                arePhoneNumbersEquivalent(contact.phoneNumber, normalized.phoneNumber),
              );

            if (
              (typeof normalized.email === 'string' && !emailExists) ||
              (typeof normalized.phoneNumber === 'string' && !phoneExists)
            ) {
              traceState.createdSecondary = true;
              await tx.contact.create({
                data: {
                  email: normalized.email,
                  phoneNumber: normalized.phoneNumber,
                  linkedId: truePrimary.id,
                  linkPrecedence: LinkPrecedence.secondary,
                },
              });

              logger.info(
                {
                  requestId: context?.requestId,
                  strategy,
                  action: 'create_secondary',
                  truePrimaryId: truePrimary.id,
                },
                'Created secondary contact for new identity data',
              );
            }

            clusterContacts = await this.fetchCluster(tx, truePrimary.id);
            return mapContactsToIdentifyResult(clusterContacts, truePrimary.id);
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        const trace: IdentifyTrace = {
          strategy: traceState.strategy,
          matchedInitially: traceState.matchedInitially,
          mergedPrimaries: traceState.mergedPrimaries,
          createdPrimary: traceState.createdPrimary,
          createdSecondary: traceState.createdSecondary,
          edgePath: buildTraceEdgePath(
            traceState.strategy,
            traceState.mergedPrimaries,
            traceState.createdSecondary,
          ),
        };

        return { result, trace };
      } catch (error) {
        const shouldRetry =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < MAX_IDENTIFY_TRANSACTION_RETRIES;

        if (!shouldRetry) {
          throw error;
        }

        logger.warn(
          { requestId: context?.requestId, attempt, maxAttempts: MAX_IDENTIFY_TRANSACTION_RETRIES },
          'Retrying identify transaction after write conflict',
        );

        await new Promise<void>((resolve) => {
          setTimeout(resolve, TRANSACTION_RETRY_DELAY_MS * attempt);
        });
      }
    }

    throw new Error('Identify transaction retries exhausted');
  }

  private async acquireIdentifierLocks(
    tx: PrismaNamespace.TransactionClient,
    input: NormalizedIdentifyInput,
  ): Promise<void> {
    const lockKeys = new Set<string>();

    if (input.email) {
      lockKeys.add(`identify:email:${input.email}`);
    }

    if (input.phoneNumber) {
      lockKeys.add(`identify:phone_safe:${input.phoneNumber}`);
    }

    if (input.aggressivePhoneNumber) {
      lockKeys.add(`identify:phone_fallback:${input.aggressivePhoneNumber}`);
    }

    const sortedKeys = [...lockKeys].sort();

    for (const lockKey of sortedKeys) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    }
  }

  private async findMatches(
    tx: PrismaNamespace.TransactionClient,
    input: NormalizedIdentifyInput,
  ): Promise<{ contacts: Contact[]; strategy: MatchStrategy }> {
    const safeMatches = await this.querySafeMatches(tx, input);
    if (safeMatches.length > 0) {
      await this.lockRows(tx, safeMatches.map((contact) => contact.id));
      const freshSafeMatches = await this.querySafeMatches(tx, input);
      return { contacts: freshSafeMatches, strategy: 'safe' };
    }

    const fallbackMatches = await this.queryFallbackMatches(tx, input);
    if (fallbackMatches.length > 0) {
      await this.lockRows(tx, fallbackMatches.map((contact) => contact.id));
      const freshFallbackMatches = await this.queryFallbackMatches(tx, input);
      return { contacts: freshFallbackMatches, strategy: 'fallback' };
    }

    return { contacts: [], strategy: 'no_match' };
  }

  private async querySafeMatches(
    tx: PrismaNamespace.TransactionClient,
    input: NormalizedIdentifyInput,
  ): Promise<Contact[]> {
    const orConditions: Prisma.ContactWhereInput[] = [];

    if (input.email) {
      orConditions.push({ email: input.email });
    }

    if (input.phoneNumber) {
      orConditions.push({ phoneNumber: input.phoneNumber });
    }

    if (orConditions.length === 0) {
      return [];
    }

    return tx.contact.findMany({
      where: {
        deletedAt: null,
        OR: orConditions,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async queryFallbackMatches(
    tx: PrismaNamespace.TransactionClient,
    input: NormalizedIdentifyInput,
  ): Promise<Contact[]> {
    if (!input.phoneNumber || !input.aggressivePhoneNumber) {
      return [];
    }

    const clauses: Prisma.Sql[] = [];

    if (input.email) {
      clauses.push(Prisma.sql`"email" = ${input.email}`);
    }

    clauses.push(
      Prisma.sql`regexp_replace(coalesce("phoneNumber", ''), '[^0-9]', '', 'g') = ${input.aggressivePhoneNumber}`,
    );

    const whereOr = Prisma.join(clauses, ' OR ');

    return tx.$queryRaw<Contact[]>(Prisma.sql`
      SELECT *
      FROM "Contact"
      WHERE "deletedAt" IS NULL
        AND (${whereOr})
      ORDER BY "createdAt" ASC, "id" ASC
    `);
  }

  private async resolveRootPrimaries(
    tx: PrismaNamespace.TransactionClient,
    contacts: Contact[],
  ): Promise<Map<number, Contact>> {
    const roots = new Map<number, Contact>();

    for (const contact of contacts) {
      const root = await this.resolveRootPrimary(tx, contact);
      roots.set(root.id, root);
    }

    return roots;
  }

  private async resolveRootPrimary(
    tx: PrismaNamespace.TransactionClient,
    contact: Contact,
  ): Promise<Contact> {
    let current = contact;
    const seen = new Set<number>();

    while (current.linkPrecedence === LinkPrecedence.secondary && current.linkedId) {
      if (seen.has(current.id)) {
        throw new Error('Circular linkedId chain detected in contacts table');
      }

      seen.add(current.id);

      const parent = await tx.contact.findUnique({ where: { id: current.linkedId } });
      if (!parent) {
        return current;
      }

      current = parent;
    }

    return current;
  }

  private async fetchCluster(
    tx: PrismaNamespace.TransactionClient,
    primaryId: number,
  ): Promise<Contact[]> {
    return tx.contact.findMany({
      where: {
        deletedAt: null,
        OR: [{ id: primaryId }, { linkedId: primaryId }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  private async lockRows(tx: PrismaNamespace.TransactionClient, ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    const uniqueIds = [...new Set(ids)].sort((a, b) => a - b);

    await tx.$executeRaw(Prisma.sql`
      SELECT "id"
      FROM "Contact"
      WHERE "id" IN (${Prisma.join(uniqueIds)})
      FOR UPDATE
    `);
  }
}
