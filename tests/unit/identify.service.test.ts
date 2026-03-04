import type { Contact } from '@prisma/client';

import {
  aggressiveNormalizePhoneNumber,
  choosePrimaryContact,
  normalizeEmail,
  normalizeIdentifyInput,
  normalizePhoneNumber,
} from '../../src/modules/identify/identify.service';

describe('identify normalization utilities', () => {
  it('normalizes email and phone safely', () => {
    expect(normalizeEmail('  USER@Example.COM ')).toBe('user@example.com');
    expect(normalizePhoneNumber('  +1 (555) 0101  ')).toBe('+1 (555) 0101');
  });

  it('normalizes aggressive phone variant for fallback matching', () => {
    expect(aggressiveNormalizePhoneNumber('+1 (555) 0101')).toBe('15550101');
  });

  it('normalizes identify payload shape', () => {
    expect(normalizeIdentifyInput({ email: ' A@A.COM ', phoneNumber: ' 123-456 ' })).toEqual({
      email: 'a@a.com',
      phoneNumber: '123-456',
      aggressivePhoneNumber: '123456',
    });
  });
});

describe('choosePrimaryContact', () => {
  it('selects the oldest createdAt then lowest id on tie', () => {
    const baseDate = new Date('2025-01-01T10:00:00.000Z');

    const candidates = [
      {
        id: 2,
        email: 'b@example.com',
        phoneNumber: '222',
        linkedId: null,
        linkPrecedence: 'primary',
        createdAt: new Date(baseDate),
        updatedAt: new Date(baseDate),
        deletedAt: null,
      },
      {
        id: 1,
        email: 'a@example.com',
        phoneNumber: '111',
        linkedId: null,
        linkPrecedence: 'primary',
        createdAt: new Date(baseDate),
        updatedAt: new Date(baseDate),
        deletedAt: null,
      },
    ] as Contact[];

    const winner = choosePrimaryContact(candidates);
    expect(winner.id).toBe(1);
  });
});
