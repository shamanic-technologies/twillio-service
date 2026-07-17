# Twilio Service

SMS sending and tracking service using Twilio. Also hosts the public **WhatsApp**
channel — a thin adapter bridging Twilio WhatsApp to **chat-service**'s agentic
chat (the same AI brain the dashboard's "Edit with AI" uses, via api-service
`/api/v1/chat`). No AI/tool logic lives here — chat-service owns the config
(system prompt + tools), model resolution, and LLM cost.

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
- **src/routes/** — Express route handlers (health, send, status, webhooks, whatsapp)
- **src/lib/twilio-client.ts** — Twilio SDK wrapper (SMS + WhatsApp channel)
- **src/lib/runs-client.ts** — Vendored HTTP client for runs-service
- **src/lib/chat-client.ts** — Consumes chat-service `POST /chat` agentic chat (SSE)
- **src/lib/client-client.ts** — Caller for client-service phone→account provisioning
- **src/db/schema.ts** — Drizzle ORM table definitions
- **src/middleware/serviceAuth.ts** — X-API-Key auth middleware
- **scripts/generate-openapi.ts** — Generates openapi.json from Zod schemas
- **tests/** — Vitest + Supertest tests (unit + integration)

## WhatsApp channel (thin adapter — no AI logic here)
- **Inbound** `POST /webhooks/twilio/whatsapp` (Twilio-signed, no X-API-Key):
  normalize sender phone → resolve/provision account → track run → forward to
  chat-service → reply over WhatsApp. Acks Twilio with empty TwiML; the reply
  is delivered via the Twilio REST API (decoupled from the webhook response).
- **Outbound** `POST /send/whatsapp` (service-authed, run-tracked).
- **Sender→account** cached in `whatsapp_users` (phone ↔ orgId/userId). Unknown
  number → provision a full signup-equivalent account (welcome credit) by calling
  **client-service `POST /internal/phone-accounts` `{ phone }` →
  `{ orgId, userId, phone, clerkOrgId, clerkUserId, created }`** (idempotent per
  phone). NEVER create Clerk orgs or grant credit here — client-service owns it.
- **Conversation continuity** in `whatsapp_sessions` (phone ↔ chat-service
  sessionId). Follow-up messages replay the stored sessionId so chat-service
  resumes the same conversation.
- **chat-service `POST /chat` is SSE-streaming**: consume the stream, accumulate
  `{type:"token",content}` frames into the reply, capture the first `{sessionId}`
  frame, stop at `"[DONE]"`. Body: `{configKey, message, sessionId?, context}`.
  `configKey` = `CHAT_WHATSAPP_CONFIG_KEY` (chat-service owns the config: system
  prompt + allowed tools). Identity headers `x-org-id/x-user-id/x-run-id` scope
  the session + let chat-service meter LLM cost against the sender's org.
- WhatsApp outbound reuses `twilio_sendings` with `channel:"whatsapp"`.
- Env: `CHAT_SERVICE_URL/_API_KEY`, `CHAT_WHATSAPP_CONFIG_KEY`,
  `CLIENT_SERVICE_URL/_API_KEY`, `TWILIO_WHATSAPP_NUMBER`. Optional:
  `CLIENT_PHONE_PROVISION_PATH`, `TWILIO_WHATSAPP_COST_NAME`,
  `TWILIO_VALIDATE_WHATSAPP_WEBHOOK`.

## Key Patterns
- Zod schemas are the single source of truth for validation + OpenAPI generation
- Never edit openapi.json manually — it's auto-generated
- Runs-service integration is BLOCKING: create run → send SMS → record → add costs → complete run
- Webhook handler uses Twilio request validation for security
- All tables linked by messageSid (Twilio's message ID)
- Port 3011
