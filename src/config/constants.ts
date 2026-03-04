export const ROUTES = {
  identify: '/identify',
  secondaryContacts: '/contacts/:primaryContactId/secondaries',
  healthLive: '/health/live',
  healthReady: '/health/ready',
} as const;
