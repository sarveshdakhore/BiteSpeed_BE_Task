import type { Contact } from '@prisma/client';

import type { IdentifyResult } from './identify.types';

function pushUnique(values: string[], value: string | null): void {
  if (!value) {
    return;
  }

  if (!values.includes(value)) {
    values.push(value);
  }
}

export function mapContactsToIdentifyResult(
  contacts: Contact[],
  primaryContatctId: number,
): IdentifyResult {
  const primaryContact =
    contacts.find((contact) => contact.id === primaryContatctId) ??
    contacts.find((contact) => contact.linkPrecedence === 'primary');

  if (!primaryContact) {
    throw new Error('Primary contact not found for identity response mapping');
  }

  const secondaryContacts = contacts
    .filter((contact) => contact.id !== primaryContact.id)
    .sort((a, b) => {
      const createdAtSort = a.createdAt.getTime() - b.createdAt.getTime();
      if (createdAtSort !== 0) {
        return createdAtSort;
      }
      return a.id - b.id;
    });

  const emails: string[] = [];
  const phoneNumbers: string[] = [];

  pushUnique(emails, primaryContact.email);
  pushUnique(phoneNumbers, primaryContact.phoneNumber);

  for (const secondaryContact of secondaryContacts) {
    pushUnique(emails, secondaryContact.email);
    pushUnique(phoneNumbers, secondaryContact.phoneNumber);
  }

  return {
    primaryContatctId: primaryContact.id,
    emails,
    phoneNumbers,
    secondaryContactIds: secondaryContacts.map((contact) => contact.id),
  };
}
