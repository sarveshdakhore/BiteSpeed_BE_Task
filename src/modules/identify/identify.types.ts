export interface IdentifyInput {
  email?: string;
  phoneNumber?: string;
}

export interface IdentifyResult {
  primaryContatctId: number;
  emails: string[];
  phoneNumbers: string[];
  secondaryContactIds: number[];
}

export interface IdentifyRequestContext {
  requestId?: string;
}

export interface NormalizedIdentifyInput {
  email?: string;
  phoneNumber?: string;
  aggressivePhoneNumber?: string;
}

export type MatchStrategy = 'safe' | 'fallback' | 'no_match';

export interface IdentifyTrace {
  strategy: MatchStrategy;
  matchedInitially: boolean;
  mergedPrimaries: boolean;
  createdPrimary: boolean;
  createdSecondary: boolean;
  edgePath: string[];
}

export interface IdentifyTraceResult {
  result: IdentifyResult;
  trace: IdentifyTrace;
}

export interface SecondaryContactDetails {
  id: number;
  phoneNumber: string | null;
  email: string | null;
  linkedId: number | null;
  linkPrecedence: 'primary' | 'secondary';
  createdAt: string;
  updatedAt: string;
}

export interface SecondaryContactsResult {
  found: boolean;
  primaryContactId: number;
  secondaryContacts: SecondaryContactDetails[];
}
