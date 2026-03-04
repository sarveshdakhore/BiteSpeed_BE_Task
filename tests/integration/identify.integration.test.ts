import request from 'supertest';

import { env } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import {
  describeIntegration,
  resetDatabase,
  runIntegrationTests,
} from '../helpers/integration';

const app = buildApp();

interface IdentifyApiContact {
  primaryContatctId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

interface SecondaryContactDetailsApiResponse {
  primaryContactId: number;
  secondaryContacts: {
    id: number;
    phoneNumber: string | null;
    email: string | null;
    linkedId: number | null;
    linkPrecedence: 'primary' | 'secondary';
    createdAt: string;
    updatedAt: string;
  }[];
}

function readContact(body: unknown): IdentifyApiContact {
  return (body as { contact: IdentifyApiContact }).contact;
}

function decodeTraceHeader(headerValue: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(headerValue, 'base64url').toString('utf-8')) as Record<string, unknown>;
}

describeIntegration('POST /identify integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await resetDatabase();
    env.APP_ENV = 'test';
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a new primary contact when no matches exist', async () => {
    const response = await request(app)
      .post('/identify')
      .send({ email: 'alice@example.com', phoneNumber: '1111111111' })
      .expect(200);

    expect(readContact(response.body)).toEqual({
      primaryContatctId: 1,
      emails: ['alice@example.com'],
      phoneNumbers: ['1111111111'],
      secondaryContactIds: [],
    });
    expect((response.body as { contact?: { primaryContactId?: number } }).contact?.primaryContactId).toBeUndefined();
  });

  it('creates a secondary contact when one identifier is new', async () => {
    await request(app)
      .post('/identify')
      .send({ email: 'alice@example.com', phoneNumber: '1111111111' })
      .expect(200);

    const response = await request(app)
      .post('/identify')
      .send({ email: 'alice+new@example.com', phoneNumber: '1111111111' })
      .expect(200);

    const contact = readContact(response.body);
    expect(contact.primaryContatctId).toBe(1);
    expect(contact.emails).toEqual(['alice@example.com', 'alice+new@example.com']);
    expect(contact.phoneNumbers).toEqual(['1111111111']);
    expect(contact.secondaryContactIds).toEqual([2]);
  });

  it('merges two primaries and reparents secondaries of demoted primary', async () => {
    await request(app)
      .post('/identify')
      .send({ email: 'older@example.com', phoneNumber: '1111111111' })
      .expect(200);

    await request(app)
      .post('/identify')
      .send({ email: 'newer@example.com', phoneNumber: '2222222222' })
      .expect(200);

    await request(app)
      .post('/identify')
      .send({ email: 'secondary@example.com', phoneNumber: '2222222222' })
      .expect(200);

    const mergeResponse = await request(app)
      .post('/identify')
      .send({ email: 'older@example.com', phoneNumber: '2222222222' })
      .expect(200);

    const mergedContact = readContact(mergeResponse.body);
    expect(mergedContact.primaryContatctId).toBe(1);
    expect(mergedContact.secondaryContactIds).toEqual(expect.arrayContaining([2, 3]));

    const demotedPrimary = await prisma.contact.findUniqueOrThrow({ where: { id: 2 } });
    const reparentedSecondary = await prisma.contact.findUniqueOrThrow({ where: { id: 3 } });

    expect(demotedPrimary.linkPrecedence).toBe('secondary');
    expect(demotedPrimary.linkedId).toBe(1);
    expect(reparentedSecondary.linkedId).toBe(1);
  });

  it('is idempotent for repeated payloads', async () => {
    await request(app)
      .post('/identify')
      .send({ email: 'same@example.com', phoneNumber: '3333333333' })
      .expect(200);

    await request(app)
      .post('/identify')
      .send({ email: 'same@example.com', phoneNumber: '3333333333' })
      .expect(200);

    const count = await prisma.contact.count();
    expect(count).toBe(1);
  });

  it('supports only email and only phone requests', async () => {
    const emailOnly = await request(app).post('/identify').send({ email: 'only@example.com' }).expect(200);
    expect(readContact(emailOnly.body).emails).toEqual(['only@example.com']);

    const phoneOnly = await request(app).post('/identify').send({ phoneNumber: '4444444444' }).expect(200);
    expect(readContact(phoneOnly.body).phoneNumbers).toEqual(['4444444444']);
  });

  it('accepts null and numeric phone payload forms from task examples', async () => {
    const first = await request(app)
      .post('/identify')
      .send({ email: null, phoneNumber: '123456' })
      .expect(200);

    expect(readContact(first.body).primaryContatctId).toBe(1);

    const second = await request(app)
      .post('/identify')
      .send({ email: null, phoneNumber: 123456 })
      .expect(200);

    expect(readContact(second.body).primaryContatctId).toBe(1);
    expect(await prisma.contact.count()).toBe(1);
  });

  it('uses fallback aggressive phone matching when safe matching misses', async () => {
    await request(app)
      .post('/identify')
      .send({ email: 'format@example.com', phoneNumber: '+1 (123) 456-7890' })
      .expect(200);

    const response = await request(app)
      .post('/identify')
      .send({ phoneNumber: '11234567890' })
      .expect(200);

    const count = await prisma.contact.count();

    expect(readContact(response.body).primaryContatctId).toBe(1);
    expect(count).toBe(1);
  });

  it('returns validation errors for invalid payload', async () => {
    await request(app).post('/identify').send({}).expect(400);
    await request(app).post('/identify').send({ email: '', phoneNumber: '' }).expect(400);
  });

  it('converges concurrent requests into a single primary cluster', async () => {
    await Promise.all([
      request(app)
        .post('/identify')
        .send({ email: 'concurrent-a@example.com', phoneNumber: '5555555555' }),
      request(app)
        .post('/identify')
        .send({ email: 'concurrent-b@example.com', phoneNumber: '5555555555' }),
    ]);

    const primaries = await prisma.contact.findMany({ where: { linkPrecedence: 'primary' } });
    const allContacts = await prisma.contact.findMany();

    expect(primaries).toHaveLength(1);
    expect(allContacts).toHaveLength(2);
  });

  it('returns trace header for trace=true in non-production app env', async () => {
    const response = await request(app)
      .post('/identify?trace=true')
      .send({ email: 'trace@example.com', phoneNumber: '9990001111' })
      .expect(200);

    const traceHeader = response.header['x-identify-trace'] as string | undefined;
    expect(typeof traceHeader).toBe('string');

    if (traceHeader) {
      const trace = decodeTraceHeader(traceHeader);
      expect(trace.strategy).toBe('no_match');
      expect(trace.createdPrimary).toBe(true);
      expect(Array.isArray(trace.edgePath)).toBe(true);
    }
  });

  it('does not return trace header for trace=true in production app env', async () => {
    const previous = env.APP_ENV;
    env.APP_ENV = 'production';

    try {
      const response = await request(app)
        .post('/identify?trace=true')
        .send({ email: 'prod-trace@example.com', phoneNumber: '9990002222' })
        .expect(200);

      expect(response.header['x-identify-trace']).toBeUndefined();
    } finally {
      env.APP_ENV = previous;
    }
  });

  it('returns secondary contact details for a primary contact', async () => {
    await request(app)
      .post('/identify')
      .send({ email: 'primary@example.com', phoneNumber: '9876543210' })
      .expect(200);

    await request(app)
      .post('/identify')
      .send({ email: 'secondary@example.com', phoneNumber: '9876543210' })
      .expect(200);

    const response = await request(app).get('/contacts/1/secondaries').expect(200);
    const body = response.body as SecondaryContactDetailsApiResponse;

    expect(body.primaryContactId).toBe(1);
    expect(body.secondaryContacts).toHaveLength(1);
    expect(body.secondaryContacts[0]?.id).toBe(2);
    expect(body.secondaryContacts[0]?.linkPrecedence).toBe('secondary');
    expect(body.secondaryContacts[0]?.linkedId).toBe(1);
    expect(body.secondaryContacts[0]?.email).toBe('secondary@example.com');
  });

  it('returns 404 for secondary details when contact id does not exist', async () => {
    await request(app).get('/contacts/999/secondaries').expect(404);
  });
});

if (!runIntegrationTests) {
  describe('integration tests', () => {
    it('skips integration tests when RUN_INTEGRATION_TESTS is not true', () => {
      expect(runIntegrationTests).toBe(false);
    });
  });
}
