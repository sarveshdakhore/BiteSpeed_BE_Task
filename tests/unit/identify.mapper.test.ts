import type { Contact } from '@prisma/client';

import { mapContactsToIdentifyResult } from '../../src/modules/identify/identify.mapper';

describe('mapContactsToIdentifyResult', () => {
  it('keeps primary values first and deduplicates arrays', () => {
    const now = new Date('2025-01-01T00:00:00.000Z');

    const contacts: Contact[] = [
      {
        id: 10,
        email: 'primary@example.com',
        phoneNumber: '9999',
        linkedId: null,
        linkPrecedence: 'primary',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      {
        id: 11,
        email: 'secondary@example.com',
        phoneNumber: '9999',
        linkedId: 10,
        linkPrecedence: 'secondary',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        updatedAt: new Date('2025-01-02T00:00:00.000Z'),
        deletedAt: null,
      },
    ];

    const result = mapContactsToIdentifyResult(contacts, 10);

    expect(result.primaryContatctId).toBe(10);
    expect(result.emails).toEqual(['primary@example.com', 'secondary@example.com']);
    expect(result.phoneNumbers).toEqual(['9999']);
    expect(result.secondaryContactIds).toEqual([11]);
  });
});
