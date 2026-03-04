import { useMemo, useState } from 'react';
import { CheckCircle2, Github, GitMerge, Loader2, PhoneCall, Server } from 'lucide-react';

import { MermaidDiagram } from './components/mermaid-diagram';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Separator } from './components/ui/separator';
import { countryCodes, type CountryCode } from './lib/countryCodes';

interface IdentifyResponse {
  contact: {
    primaryContatctId: number;
    emails: string[];
    phoneNumbers: string[];
    secondaryContactIds: number[];
  };
}

interface IdentifyTrace {
  strategy: 'safe' | 'fallback' | 'no_match';
  matchedInitially: boolean;
  mergedPrimaries: boolean;
  createdPrimary: boolean;
  createdSecondary: boolean;
  edgePath: string[];
}

type TraceStatus = 'idle' | 'available' | 'missing' | 'invalid';
type RequestMode = 'form' | 'json';

interface SecondaryContactDetail {
  id: number;
  phoneNumber: string | null;
  email: string | null;
  linkedId: number | null;
  linkPrecedence: 'primary' | 'secondary';
  createdAt: string;
  updatedAt: string;
}

interface SecondaryContactsResponse {
  primaryContactId: number;
  secondaryContacts: SecondaryContactDetail[];
}

interface FlowTestCase {
  title: string;
  purpose: string;
  steps: string[];
  expectedEdgePath?: string[];
  expectedSummary?: string;
}

const navItems = [
  { label: 'Playground', href: '#playground' },
  { label: 'Result', href: '#result' },
  { label: 'Flow', href: '#flow' },
  { label: 'Overview', href: '#overview' },
  { label: 'Notes', href: '#notes' },
  { label: 'Test Cases', href: '#testcases' },
];

const defaultRawJsonBody = `{
  "email": "jane@brand.com",
  "phoneNumber": "+919876543210"
}`;

const flowTestCases: FlowTestCase[] = [
  {
    title: 'TC1 - Brand new contact (Scenario 1)',
    purpose: 'No safe/fallback match, so a brand new primary is created.',
    steps: ['POST /identify {"email":"tc1-new@example.com","phoneNumber":"7000000001"}'],
    expectedEdgePath: ['E01', 'E02', 'E03', 'E17'],
  },
  {
    title: 'TC2 - Existing + new email (Scenario 2)',
    purpose: 'Safe match on phone, then create a secondary because email is new.',
    steps: [
      'POST /identify {"email":"tc2-primary@example.com","phoneNumber":"7000000002"}',
      'POST /identify {"email":"tc2-secondary@example.com","phoneNumber":"7000000002"}',
    ],
    expectedEdgePath: ['E01', 'E05', 'E06', 'E10', 'E12', 'E13', 'E15'],
  },
  {
    title: 'TC3 - Existing + new phone (Scenario 2)',
    purpose: 'Safe match on email, then create a secondary because phone is new.',
    steps: [
      'POST /identify {"email":"tc3-primary@example.com","phoneNumber":"7000000003"}',
      'POST /identify {"email":"tc3-primary@example.com","phoneNumber":"7999999993"}',
    ],
    expectedEdgePath: ['E01', 'E05', 'E06', 'E10', 'E12', 'E13', 'E15'],
  },
  {
    title: 'TC4 - Merge two primaries (Scenario 3)',
    purpose: 'Two existing primaries are linked, newer one is demoted and re-parented.',
    steps: [
      'POST /identify {"email":"tc4-old@example.com","phoneNumber":"7000000004"}',
      'POST /identify {"email":"tc4-new@example.com","phoneNumber":"7999999994"}',
      'POST /identify {"email":"tc4-old@example.com","phoneNumber":"7999999994"}',
    ],
    expectedEdgePath: ['E01', 'E05', 'E06', 'E07', 'E08', 'E09', 'E11', 'E14', 'E16'],
  },
  {
    title: 'TC5 - Idempotent repeat (no new row)',
    purpose: 'Same payload twice should not create additional contacts.',
    steps: [
      'POST /identify {"email":"tc5@example.com","phoneNumber":"7000000005"}',
      'POST /identify {"email":"tc5@example.com","phoneNumber":"7000000005"}',
    ],
    expectedEdgePath: ['E01', 'E05', 'E06', 'E10', 'E12', 'E14', 'E16'],
    expectedSummary: 'Expected path for the second request (idempotent repeat).',
  },
  {
    title: 'TC6 - Fallback phone matching',
    purpose: 'Safe miss, fallback hits by digits-only phone normalization.',
    steps: [
      'POST /identify {"email":"tc6@example.com","phoneNumber":"+1 (700) 000-0006"}',
      'POST /identify {"phoneNumber":"17000000006"}',
    ],
    expectedEdgePath: ['E01', 'E02', 'E04', 'E06', 'E10', 'E12', 'E14', 'E16'],
    expectedSummary: 'Expected path for the second request (fallback match).',
  },
  {
    title: 'TC7 - Null and numeric compatibility',
    purpose: 'Verifies PDF-compatible null input and numeric phone input.',
    steps: [
      'POST /identify {"email":null,"phoneNumber":"7000000007"}',
      'POST /identify {"email":null,"phoneNumber":7000000007}',
    ],
    expectedSummary:
      'First request creates primary. Second request resolves same cluster and creates no new row.',
  },
  {
    title: 'TC8 - Single identifier modes',
    purpose: 'Verifies only-email and only-phone requests both succeed.',
    steps: [
      'POST /identify {"email":"tc8-email-only@example.com"}',
      'POST /identify {"phoneNumber":"7000000008"}',
    ],
    expectedSummary: 'Each request should create/resolve cluster without validation error.',
  },
];

const flowEdges = [
  { id: 'E01', from: 'A', to: 'B', line: 'A --> B' },
  { id: 'E02', from: 'B', to: 'C', line: 'B -->|No| C' },
  { id: 'E03', from: 'C', to: 'D', line: 'C -->|No| D' },
  { id: 'E04', from: 'C', to: 'E', line: 'C -->|Yes| E' },
  { id: 'E05', from: 'B', to: 'E', line: 'B -->|Yes| E' },
  { id: 'E06', from: 'E', to: 'F', line: 'E --> F' },
  { id: 'E07', from: 'F', to: 'G', line: 'F -->|Yes| G' },
  { id: 'E08', from: 'G', to: 'H', line: 'G --> H' },
  { id: 'E09', from: 'H', to: 'I', line: 'H --> I' },
  { id: 'E10', from: 'F', to: 'J', line: 'F -->|No| J' },
  { id: 'E11', from: 'I', to: 'K', line: 'I --> K' },
  { id: 'E12', from: 'J', to: 'K', line: 'J --> K' },
  { id: 'E13', from: 'K', to: 'L', line: 'K -->|Yes| L' },
  { id: 'E14', from: 'K', to: 'M', line: 'K -->|No| M' },
  { id: 'E15', from: 'L', to: 'N', line: 'L --> N' },
  { id: 'E16', from: 'M', to: 'N', line: 'M --> N' },
  { id: 'E17', from: 'D', to: 'N', line: 'D --> N' },
] as const;

const flowNodes = [
  'A[Request: email/phone]',
  'B{Safe Match?}',
  'C{Fallback Phone Match?}',
  'D[Create Primary Contact]',
  'E[Resolve to Root Primaries]',
  'F{Multiple Primaries?}',
  'G[Keep Oldest as Primary]',
  'H[Demote Newer Primaries]',
  'I[Re-parent All Secondaries]',
  'J[Use Existing Primary]',
  'K{New Data in Cluster?}',
  'L[Create Secondary]',
  'M[No New Row]',
  'N[Return Consolidated Contact]',
] as const;

const allNodeIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'] as const;

const flowEdgeDescriptions: Record<string, string> = {
  E01: 'Receive identify request and begin safe matching.',
  E02: 'Safe matching found no contact; run fallback phone matching.',
  E03: 'Fallback found no contact; create a new primary contact.',
  E04: 'Fallback found a contact; resolve root primaries.',
  E05: 'Safe matching found a contact; resolve root primaries.',
  E06: 'Evaluate whether multiple primaries exist.',
  E07: 'Multiple primaries found; keep the oldest as primary.',
  E08: 'Demote newer primaries to secondary.',
  E09: 'Re-parent secondaries of demoted primaries.',
  E10: 'Single primary cluster found; continue with existing primary.',
  E11: 'After merge, check if incoming identifiers are new.',
  E12: 'Check if incoming identifiers are new in existing cluster.',
  E13: 'New identifier detected; create a secondary contact.',
  E14: 'No new identifier; do not create a new row.',
  E15: 'Return consolidated contact after creating secondary.',
  E16: 'Return consolidated contact without creating a new row.',
  E17: 'Return consolidated contact with only the new primary.',
};

function toHumanReadableFlow(edgePath: string[]): string[] {
  return edgePath.map((edgeId) => flowEdgeDescriptions[edgeId] ?? `Unknown step (${edgeId})`);
}

function cleanPhoneInput(raw: string): string {
  return raw.replace(/[^0-9\s\-()]/g, '').trim();
}

function toRequestPhone(country: CountryCode, localPhone: string): string | undefined {
  const cleaned = cleanPhoneInput(localPhone).replace(/\s+/g, '');
  if (!cleaned) {
    return undefined;
  }

  return `${country.dialCode}${cleaned}`;
}

function normalizeEmptyStringsToNull(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  const keys: Array<'email' | 'phoneNumber'> = ['email', 'phoneNumber'];

  for (const key of keys) {
    if (!(key in normalized)) {
      continue;
    }

    const value = normalized[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      normalized[key] = trimmed.length === 0 ? null : trimmed;
    }
  }

  return normalized;
}

function isIdentifyTrace(value: unknown): value is IdentifyTrace {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const trace = value as Partial<IdentifyTrace>;
  return (
    (trace.strategy === 'safe' || trace.strategy === 'fallback' || trace.strategy === 'no_match') &&
    typeof trace.matchedInitially === 'boolean' &&
    typeof trace.mergedPrimaries === 'boolean' &&
    typeof trace.createdPrimary === 'boolean' &&
    typeof trace.createdSecondary === 'boolean' &&
    Array.isArray(trace.edgePath)
  );
}

function decodeTraceHeader(headerValue: string | null): IdentifyTrace | null {
  if (!headerValue) {
    return null;
  }

  try {
    const normalized = headerValue.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const decoded = atob(`${normalized}${padding}`);
    const parsed = JSON.parse(decoded) as unknown;

    return isIdentifyTrace(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function buildFlowchart(trace: IdentifyTrace | null): string {
  const lines: string[] = ['flowchart TD', ...flowNodes, ...flowEdges.map((edge) => edge.line)];

  if (!trace) {
    return lines.join('\n');
  }

  const takenEdges = new Set(trace.edgePath);
  const takenNodes = new Set<string>(['A']);

  for (const edge of flowEdges) {
    if (takenEdges.has(edge.id)) {
      takenNodes.add(edge.from);
      takenNodes.add(edge.to);
    }
  }

  lines.push('classDef activeNode fill:#eaf3ff,stroke:#2f80ff,stroke-width:2px,color:#0f172a;');
  lines.push('classDef inactiveNode fill:#f8fafc,stroke:#d5dbe7,color:#94a3b8,opacity:0.5;');

  for (const nodeId of allNodeIds) {
    lines.push(`class ${nodeId} ${takenNodes.has(nodeId) ? 'activeNode' : 'inactiveNode'};`);
  }

  flowEdges.forEach((edge, index) => {
    if (takenEdges.has(edge.id)) {
      lines.push(`linkStyle ${index} stroke:#1d72ff,stroke-width:3px,opacity:1;`);
      return;
    }

    lines.push(`linkStyle ${index} stroke:#b8c2d6,stroke-width:2px,opacity:0.25;`);
  });

  return lines.join('\n');
}

export default function App(): React.JSX.Element {
  const defaultApiBaseUrl =
    import.meta.env.VITE_API_BASE_URL ||
    (import.meta.env.PROD ? 'https://bitespeed-be.nexmun.in' : 'http://localhost:3000');
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultApiBaseUrl);
  const [requestMode, setRequestMode] = useState<RequestMode>('json');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState(countryCodes[0]?.code ?? 'IN');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [rawJsonBody, setRawJsonBody] = useState(defaultRawJsonBody);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trace, setTrace] = useState<IdentifyTrace | null>(null);
  const [traceStatus, setTraceStatus] = useState<TraceStatus>('idle');
  const [isSecondaryModalOpen, setIsSecondaryModalOpen] = useState(false);
  const [secondaryContacts, setSecondaryContacts] = useState<SecondaryContactDetail[]>([]);
  const [secondaryPrimaryId, setSecondaryPrimaryId] = useState<number | null>(null);
  const [secondaryLoading, setSecondaryLoading] = useState(false);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);

  const selectedCountry = useMemo(
    () => countryCodes.find((country) => country.code === countryCode) ?? countryCodes[0],
    [countryCode],
  );

  const flowchart = useMemo(() => buildFlowchart(trace), [trace]);
  const runtimeHumanFlow = useMemo(() => (trace ? toHumanReadableFlow(trace.edgePath) : []), [trace]);
  const isSubmitDisabled = loading || (requestMode === 'form' ? !email.trim() && !phoneNumber.trim() : !rawJsonBody.trim());

  const submitIdentify = async (): Promise<void> => {
    let payload: Record<string, unknown>;

    if (requestMode === 'json') {
      try {
        const parsed = JSON.parse(rawJsonBody) as unknown;

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setError('JSON body must be a valid JSON object.');
          setResult(null);
          setTrace(null);
          setTraceStatus('idle');
          return;
        }

        payload = parsed as Record<string, unknown>;
      } catch (_error) {
        setError('Invalid JSON body. Please fix JSON syntax and try again.');
        setResult(null);
        setTrace(null);
        setTraceStatus('idle');
        return;
      }
    } else {
      if (!selectedCountry) {
        return;
      }

      payload = { email };

      const preparedPhone = toRequestPhone(selectedCountry, phoneNumber);
      payload.phoneNumber = preparedPhone ?? '';

      const normalizedFormPayload = normalizeEmptyStringsToNull(payload);
      if (normalizedFormPayload.email === null && normalizedFormPayload.phoneNumber === null) {
        setError('Provide at least one non-empty email or phone number.');
        setResult(null);
        setTrace(null);
        setTraceStatus('idle');
        return;
      }
    }

    payload = normalizeEmptyStringsToNull(payload);

    setLoading(true);
    setError(null);
    setTrace(null);
    setTraceStatus('idle');
    setIsSecondaryModalOpen(false);
    setSecondaryContacts([]);
    setSecondaryPrimaryId(null);
    setSecondaryLoading(false);
    setSecondaryError(null);

    try {
      const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/identify?trace=true`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as IdentifyResponse | { error?: { message?: string } };

      if (!response.ok) {
        setResult(null);
        setError(data && 'error' in data ? data.error?.message ?? 'Request failed' : 'Request failed');
        setTrace(null);
        setTraceStatus('idle');
        return;
      }

      const traceHeader = response.headers.get('x-identify-trace');
      const parsedTrace = decodeTraceHeader(traceHeader);

      if (traceHeader && parsedTrace) {
        setTrace(parsedTrace);
        setTraceStatus('available');
      } else if (traceHeader && !parsedTrace) {
        setTrace(null);
        setTraceStatus('invalid');
      } else {
        setTrace(null);
        setTraceStatus('missing');
      }

      setResult(data as IdentifyResponse);
    } catch (_requestError) {
      setResult(null);
      setTrace(null);
      setTraceStatus('idle');
      setError('Unable to reach backend. Ensure API is running and CORS allows :3008.');
    } finally {
      setLoading(false);
    }
  };

  const openSecondaryDetailsModal = async (): Promise<void> => {
    if (!result) {
      return;
    }

    setIsSecondaryModalOpen(true);
    setSecondaryLoading(true);
    setSecondaryError(null);
    setSecondaryContacts([]);

    try {
      const endpoint = `${apiBaseUrl.replace(/\/$/, '')}/contacts/${result.contact.primaryContatctId}/secondaries`;
      const response = await fetch(endpoint);
      const data = (await response.json()) as SecondaryContactsResponse | { error?: { message?: string } };

      if (!response.ok) {
        setSecondaryError(data && 'error' in data ? data.error?.message ?? 'Request failed' : 'Request failed');
        setSecondaryPrimaryId(null);
        return;
      }

      const secondaryData = data as SecondaryContactsResponse;
      setSecondaryContacts(secondaryData.secondaryContacts);
      setSecondaryPrimaryId(secondaryData.primaryContactId);
    } catch (_error) {
      setSecondaryError('Unable to fetch secondary contact details from backend.');
      setSecondaryPrimaryId(null);
    } finally {
      setSecondaryLoading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 md:px-10">
          <div className="flex items-center gap-3">
            <img
              src="/image.png"
              alt="Bitespeed"
              className="h-10 w-10 rounded-lg border border-border bg-white object-cover"
            />
            <div>
              <p className="font-sora text-xl font-bold tracking-tight">Bitespeed</p>
              <p className="text-xs text-muted-foreground">Identity Playground</p>
            </div>
          </div>

          <nav className="hidden items-center gap-2 lg:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <a
            href="https://github.com/sarveshdakhore/BiteSpeed_BE_Task"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-accent hover:text-accent-foreground"
          >
            <Github className="h-4 w-4" />
            Github Repo
          </a>
        </div>

        <nav className="mx-auto flex w-full max-w-7xl items-center gap-2 overflow-x-auto px-4 pb-3 lg:hidden md:px-10">
          {navItems.map((item) => (
            <a
              key={`${item.href}-mobile`}
              href={item.href}
              className="whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-16 px-4 pb-20 pt-10 md:space-y-24 md:px-10 md:pt-14">
        <section id="playground" className="scroll-mt-32 space-y-6">
          <div className="space-y-3">
            <Badge>Quick API Runner</Badge>
            <h1 className="font-sora text-3xl font-extrabold leading-tight tracking-tight md:text-5xl">
              Test your <span className="text-primary">`/identify`</span> API first.
            </h1>
            <p className="max-w-3xl text-muted-foreground">
              Submit payloads, check consolidated contact output, and verify identity reconciliation behavior.
            </p>
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.05fr]">
            <Card className="bitespeed-grid bg-[size:22px_22px]">
              <CardHeader>
                <CardTitle className="text-2xl">Try `POST /identify`</CardTitle>
                <CardDescription>Run real payloads against your backend from this UI.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="api-base-url">Backend Base URL</Label>
                  <Input
                    id="api-base-url"
                    value={apiBaseUrl}
                    onChange={(event) => setApiBaseUrl(event.target.value)}
                    placeholder="http://localhost:3000"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Request Body Mode</Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      type="button"
                      variant={requestMode === 'form' ? 'default' : 'outline'}
                      onClick={() => setRequestMode('form')}
                    >
                      Form Fields
                    </Button>
                    <Button
                      type="button"
                      variant={requestMode === 'json' ? 'default' : 'outline'}
                      onClick={() => setRequestMode('json')}
                    >
                      Raw JSON Body
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">This playground always sends JSON body (never form-data).</p>
                </div>

                {requestMode === 'form' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email (optional)</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="jane@brand.com"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Phone Number (optional)</Label>
                      <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
                        <Select value={countryCode} onValueChange={setCountryCode}>
                          <SelectTrigger>
                            <SelectValue placeholder="Country code" />
                          </SelectTrigger>
                          <SelectContent>
                            {countryCodes.map((country) => (
                              <SelectItem key={`${country.code}-${country.dialCode}`} value={country.code}>
                                <span className="flex items-center gap-2">
                                  <span>{country.flag}</span>
                                  <span>{country.name}</span>
                                  <span className="text-muted-foreground">{country.dialCode}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Input
                          value={phoneNumber}
                          onChange={(event) => setPhoneNumber(event.target.value)}
                          placeholder="9876543210"
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="raw-json-body">Raw JSON Body</Label>
                    <textarea
                      id="raw-json-body"
                      value={rawJsonBody}
                      onChange={(event) => setRawJsonBody(event.target.value)}
                      className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      placeholder='{"email":"jane@brand.com","phoneNumber":"+919876543210"}'
                    />
                  </div>
                )}

                <Button className="w-full" size="lg" disabled={isSubmitDisabled} onClick={() => void submitIdentify()}>
                  {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Server className="mr-2 h-4 w-4" />}
                  Identify Contact
                </Button>

                {error ? (
                  <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card id="result" className="scroll-mt-32 h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <CheckCircle2 className="h-5 w-5 text-primary" /> API Result
                </CardTitle>
                <CardDescription>Primary and secondary grouping returned by backend.</CardDescription>
              </CardHeader>
              <CardContent>
                {result ? (
                  <div className="space-y-5 text-sm">
                    <div className="rounded-lg border border-border/70 bg-background/60 p-4">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">Primary Contact ID</p>
                      <p className="mt-1 text-2xl font-bold">#{result.contact.primaryContatctId}</p>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <p className="font-semibold">Emails</p>
                      <div className="flex flex-wrap gap-2">
                        {result.contact.emails.map((entry) => (
                          <Badge key={entry}>{entry}</Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="font-semibold">Phone Numbers</p>
                      <div className="flex flex-wrap gap-2">
                        {result.contact.phoneNumbers.map((entry) => (
                          <Badge key={entry} variant="secondary">
                            {entry}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <p className="font-semibold">Secondary Contact IDs</p>
                      <div className="flex flex-wrap gap-2">
                        {result.contact.secondaryContactIds.length > 0 ? (
                          result.contact.secondaryContactIds.map((entry) => (
                            <Badge key={entry} variant="outline">
                              #{entry}
                            </Badge>
                          ))
                        ) : (
                          <p className="text-muted-foreground">No secondary contacts yet.</p>
                        )}
                      </div>
                    </div>

                    <a
                      href="#flow"
                      className="inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground"
                    >
                      View Decision Flow for This Result
                    </a>

                    <Button
                      variant="outline"
                      onClick={() => void openSecondaryDetailsModal()}
                      disabled={secondaryLoading || result.contact.secondaryContactIds.length === 0}
                    >
                      {secondaryLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Inspect Secondary Contact Details
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border/80 bg-background/40 p-8 text-sm text-muted-foreground">
                    Submit a request to view the consolidated contact payload.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="flow" className="scroll-mt-32">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <GitMerge className="h-5 w-5 text-primary" /> Reconciliation Flow
              </CardTitle>
              <CardDescription>
                Actual runtime path is highlighted in blue. Non-taken branches are faded.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <MermaidDiagram chart={flowchart} />
              {traceStatus === 'available' && trace ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge>strategy: {trace.strategy}</Badge>
                    <Badge variant="secondary">matchedInitially: {String(trace.matchedInitially)}</Badge>
                    <Badge variant="secondary">mergedPrimaries: {String(trace.mergedPrimaries)}</Badge>
                    <Badge variant="secondary">createdPrimary: {String(trace.createdPrimary)}</Badge>
                    <Badge variant="secondary">createdSecondary: {String(trace.createdSecondary)}</Badge>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/70 p-4">
                    <p className="text-sm font-semibold">Human-Readable Path Followed</p>
                    <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                      {runtimeHumanFlow.map((step, index) => (
                        <p key={`${step}-${index}`}>
                          {index + 1}. {step}
                        </p>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
              {traceStatus === 'missing' ? (
                <p className="text-xs text-muted-foreground">
                  Trace unavailable from backend. Ensure non-production mode and `?trace=true` support.
                </p>
              ) : null}
              {traceStatus === 'invalid' ? (
                <p className="text-xs text-muted-foreground">
                  Trace header received but could not be decoded. Flowchart shown in static mode.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <section id="overview" className="scroll-mt-32 space-y-6">
          <div className="space-y-3">
            <Badge>Identity Reconciliation Engine</Badge>
            <h2 className="font-sora text-3xl font-bold tracking-tight md:text-4xl">How this solves the task</h2>
            <p className="max-w-3xl text-muted-foreground">
              Deterministic primary-secondary linking with safe/fallback matching and cluster-aware updates.
            </p>
          </div>
        </section>

        <section id="notes" className="scroll-mt-32 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Safe + Fallback Matching</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Email + safe phone match first, then fallback aggressive normalization only if no safe match.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Deterministic Primary</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Oldest `createdAt` wins primary status; ties resolve by lowest contact ID.
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Cluster Re-parenting</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              When primaries merge, all existing secondaries of the demoted primary are relinked correctly.
            </CardContent>
          </Card>
        </section>

        <section id="testcases" className="scroll-mt-32">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Flow Coverage Test Cases</CardTitle>
              <CardDescription>
                Use these request series to validate every major path in the reconciliation flowchart.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-foreground">
                Disclaimer: These cases may already be tested in database. Change email/phone values to
                observe each flow path clearly.
              </div>
              {flowTestCases.map((testCase) => (
                <div key={testCase.title} className="rounded-lg border border-border/70 bg-background/70 p-4">
                  <p className="font-semibold">{testCase.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{testCase.purpose}</p>
                  <div className="mt-3 space-y-1.5 text-xs font-mono text-foreground/90">
                    {testCase.steps.map((step) => (
                      <p key={step}>{step}</p>
                    ))}
                  </div>
                  {testCase.expectedSummary ? (
                    <p className="mt-3 text-xs text-primary">{testCase.expectedSummary}</p>
                  ) : null}
                  {testCase.expectedEdgePath ? (
                    <div className="mt-3 space-y-1 text-xs text-primary">
                      {toHumanReadableFlow(testCase.expectedEdgePath).map((flowStep, index) => (
                        <p key={`${testCase.title}-${index}`}>
                          {index + 1}. {flowStep}
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </main>

      {isSecondaryModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/45 p-4 md:p-8" role="dialog" aria-modal="true">
          <div className="mx-auto mt-10 w-full max-w-3xl rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border/80 px-4 py-3 md:px-6">
              <div>
                <p className="text-base font-semibold">Secondary Contact Details</p>
                <p className="text-xs text-muted-foreground">
                  {secondaryPrimaryId ? `Primary Contact #${secondaryPrimaryId}` : 'Loading cluster context'}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setIsSecondaryModalOpen(false)}>
                Close
              </Button>
            </div>

            <div className="max-h-[68vh] space-y-3 overflow-y-auto px-4 py-4 md:px-6">
              {secondaryLoading ? (
                <p className="inline-flex items-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Fetching secondary contacts...
                </p>
              ) : null}

              {!secondaryLoading && secondaryError ? (
                <div className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {secondaryError}
                </div>
              ) : null}

              {!secondaryLoading && !secondaryError && secondaryContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No secondary contacts found for this cluster.</p>
              ) : null}

              {!secondaryLoading &&
                !secondaryError &&
                secondaryContacts.map((contact) => (
                  <div key={contact.id} className="rounded-lg border border-border/80 bg-background/70 p-4 text-sm">
                    <p className="font-semibold">Secondary #{contact.id}</p>
                    <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                      <p>Email: {contact.email ?? 'null'}</p>
                      <p>Phone: {contact.phoneNumber ?? 'null'}</p>
                      <p>Linked To: {contact.linkedId ? `#${contact.linkedId}` : 'null'}</p>
                      <p>Precedence: {contact.linkPrecedence}</p>
                      <p>Created: {new Date(contact.createdAt).toLocaleString()}</p>
                      <p>Updated: {new Date(contact.updatedAt).toLocaleString()}</p>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      ) : null}

      <footer className="mx-auto flex w-full max-w-7xl flex-col items-start justify-between gap-2 border-t border-border/70 px-4 py-6 text-xs text-muted-foreground md:flex-row md:items-center md:px-10">
        <p>Built for Bitespee Backend Task</p>
        <p className="inline-flex items-center gap-1">
          <PhoneCall className="h-3.5 w-3.5" /> Phone values are sent as strings (E.164 style)
        </p>
      </footer>
    </div>
  );
}
