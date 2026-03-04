# Bitespeed Identity Reconciliation API

Production-grade implementation of Bitespeed's identity reconciliation task using **Node.js + TypeScript + Express + Prisma + PostgreSQL**.
Includes a modern **React + TypeScript** frontend playground for testing and visualizing reconciliation flow.

## Live URLs

- Frontend: `https://bitespeed.sarveshdakhore.in`
- Backend: `https://bitespeed-be.sarveshdakhore.in`
- Identify endpoint: `https://bitespeed-be.sarveshdakhore.in/identify`

## Live Contract

### `POST /identify`

Accepts:

```json
{
  "email": "string | null (optional)",
  "phoneNumber": "string | number | null (optional)"
}
```

Rules:

- At least one identifier is required.
- `null` is treated as a missing value (as shown in the task PDF examples).
- Empty/whitespace-only strings are rejected with `400`.
- `phoneNumber` accepts numeric input and is converted to string internally.
- Safe normalization runs first: email lowercased/trimmed, phone trimmed.
- Aggressive phone fallback (digits-only compare) runs only when safe matching returns no contacts.

Returns:

```json
{
  "contact": {
    "primaryContatctId": 1,
    "emails": ["primary@example.com", "secondary@example.com"],
    "phoneNumbers": ["9999999999", "8888888888"],
    "secondaryContactIds": [2, 3]
  }
}
```

### Optional Trace Header (Dev/Test)

- Send `POST /identify?trace=true` to request execution tracing.
- In non-production environments, backend responds with `x-identify-trace` header (base64url JSON).
- Response body contract stays unchanged.

## Core Reconciliation Behavior

1. No match -> create new `primary` contact.
2. Match + new identifier -> create `secondary` linked to true primary.
3. Multiple primaries matched -> oldest primary wins; newer primaries demoted to `secondary`; all their secondaries re-linked to winner.
4. Idempotent payloads -> no duplicate rows.

## API Health Endpoints

- `GET /health/live`
- `GET /health/ready`

## Secondary Details Endpoint

### `GET /contacts/:primaryContactId/secondaries`

Returns full details of all secondary contacts linked to the provided primary cluster.

Example response:

```json
{
  "primaryContactId": 1,
  "secondaryContacts": [
    {
      "id": 2,
      "phoneNumber": "9999999999",
      "email": "secondary@example.com",
      "linkedId": 1,
      "linkPrecedence": "secondary",
      "createdAt": "2026-03-04T12:00:00.000Z",
      "updatedAt": "2026-03-04T12:00:00.000Z"
    }
  ]
}
```

## Architecture Notes

- Transactional reconciliation with `SERIALIZABLE` isolation.
- Advisory locks per normalized identifier prevent split-brain writes under concurrency.
- Structured JSON logging with request ID correlation.
- Helmet + CORS + rate limiting on `/identify`.

## Local Development (Docker-first)

### 1) Start dev stack

```bash
docker compose -f docker-compose.dev.yml up --build
```

App: `http://localhost:3000`

### 2) Test the API

```bash
curl --location 'http://localhost:3000/identify' \
--header 'Content-Type: application/json' \
--data-raw '{
  "email": "alice@example.com",
  "phoneNumber": "9999999999"
}'
```

### 3) Stop stack

```bash
docker compose -f docker-compose.dev.yml down
```

## Non-Docker Local Run

```bash
npm install
npm run prisma:generate
npm run prisma:deploy
npm run dev
```

## Frontend Playground (React + TypeScript)

The `frontend/` app is a BiteSpeed-inspired test UI with:

- Light-mode only layout
- Country-code dropdown with flag + country name + dial code
- Live request/response panel for `POST /identify`
- Mermaid flowchart visualization with runtime path highlighting:
  - taken path highlighted in blue
  - non-taken paths faded

### Run frontend on port 3008

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:3008`

Backend CORS should include `http://localhost:3008` (already reflected in `.env.example` and `.env.development.example`).
By default, frontend API base URL resolves as:

- Development: `http://localhost:3000`
- Production: `https://bitespeed-be.sarveshdakhore.in`

You can override either using `VITE_API_BASE_URL`.

## Testing

### Unit tests

```bash
npm run test:unit
```

### Integration tests

Requires running PostgreSQL reachable by `DATABASE_URL` (default test template points to `localhost:5432/bitespeed`).

```bash
RUN_INTEGRATION_TESTS=true npm run test:integration
```

### Full suite

```bash
npm test
```

## Dev vs Production Separation

- `APP_ENV` supports `development`, `test`, `production`.
- Separate env templates:
  - `.env.development.example`
  - `.env.test.example`
  - `.env.production.example`
- Multi-stage Docker build:
  - `dev` target: watch mode
  - `build` target: compile TypeScript
  - `prod` target: minimal runtime
- Dedicated compose files:
  - `docker-compose.dev.yml`
  - `docker-compose.prod.yml`

## Render Deployment

Repository contains `render.yaml` for docker-based deployment with managed PostgreSQL.

Expected production envs:

- `APP_ENV=production`
- `NODE_ENV=production`
- `DATABASE_URL=<render postgres connection string>`
- `PORT=8009`
- `CORS_ORIGIN=https://bitespeed.sarveshdakhore.in`

Health check path: `/health/ready`

## Submission Checklist (From PDF)

- Publish the code repository to GitHub.
- Keep a clean commit history with small, insightful commit messages.
- Expose `/identify` publicly.
- Host the app online and include the endpoint URL in this README.
- Use JSON request body (not form-data).

## Project Structure

```text
src/
  app.ts
  index.ts
  config/
  lib/
  middleware/
  health/
  modules/identify/
prisma/
  schema.prisma
  migrations/
tests/
  unit/
  integration/
  helpers/
Dockerfile
docker-compose.dev.yml
docker-compose.prod.yml
render.yaml
frontend/
  src/
  package.json
  vite.config.ts
```

## Useful Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run ci
```
