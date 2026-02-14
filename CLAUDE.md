# Twilio Service

SMS sending and tracking service using Twilio.

## Commands
- `npm run dev` — start dev server with hot reload
- `npm run build` — compile TS + generate OpenAPI spec
- `npm test` — run all tests
- `npm run test:unit` — unit tests only
- `npm run test:integration` — integration tests only
- `npm run db:generate` — generate Drizzle migrations
- `npm run db:push` — push schema to DB
- `npm run generate:openapi` — regenerate openapi.json

## Architecture
- **src/schemas.ts** — Zod schemas + OpenAPI registry (single source of truth)
- **src/routes/** — Express route handlers (health, send, status, webhooks)
- **src/lib/twilio-client.ts** — Twilio SDK wrapper
- **src/lib/runs-client.ts** — Vendored HTTP client for runs-service
- **src/db/schema.ts** — Drizzle ORM table definitions
- **src/middleware/serviceAuth.ts** — X-API-Key auth middleware
- **scripts/generate-openapi.ts** — Generates openapi.json from Zod schemas
- **tests/** — Vitest + Supertest tests (unit + integration)

## Key Patterns
- Zod schemas are the single source of truth for validation + OpenAPI generation
- Never edit openapi.json manually — it's auto-generated
- Runs-service integration is BLOCKING: create run → send SMS → record → add costs → complete run
- Webhook handler uses Twilio request validation for security
- All tables linked by messageSid (Twilio's message ID)
- Port 3011
