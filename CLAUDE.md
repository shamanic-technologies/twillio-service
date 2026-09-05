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
- **src/routes/** — Express route handlers (health, send, status, webhooks, whatsapp, calls)
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
  `configKey` = code constant `"whatsapp"` (chat-service owns the config: system
  prompt + allowed tools). Identity headers `x-org-id/x-user-id/x-run-id` scope
  the session + let chat-service meter LLM cost against the sender's org.
- WhatsApp outbound reuses `twilio_sendings` with `channel:"whatsapp"`.
- **Code-owned channel config (NOT env):** the WhatsApp sender number
  (`whatsapp:+14155238886` sandbox, swap to prod sender in code once live), the
  chat config key (`"whatsapp"`), the webhook-validation flag (on by default),
  and the WhatsApp cost name (`twilio-whatsapp-message`, byte-equal to the
  costs-service catalog row) are all constants in `src/lib` / `src/routes`.
- **Twilio account creds via key-service** (NOT env): the platform Twilio
  account SID + auth token are resolved from key-service, provider `"twilio"`,
  platform-decrypt `GET /keys/platform/twilio/decrypt` → decrypted value is JSON
  `{accountSid, authToken}`. Fails loud if the provider/key is absent — no env
  fallback. Covers BOTH the SMS and WhatsApp Twilio client.
- Env: `CHAT_SERVICE_URL/_API_KEY`, `CLIENT_SERVICE_URL/_API_KEY`,
  `KEY_SERVICE_URL/_API_KEY`, `TWILIO_SERVICE_PUBLIC_URL` (service public URL —
  the Twilio webhook/status-callback URL is this base + route path). Optional:
  `CLIENT_PHONE_PROVISION_PATH`.

## Voice channel (outbound call, two keypresses)
- **`POST /calls`** (service-authed, run-tracked): ring `to`, read a short spoken
  summary of why, and require the person who picks up to **press 1 to take the
  call**. Nothing but that opener plays before the keypress, so a voicemail hears
  only the summary and the call is never recorded as taken. Once taken they hear
  who replied, which company, and what they wrote.
- **Second keypress bridges.** Only when `connectTo` was supplied is a second,
  deliberate keypress offered; pressing 1 again `<Dial>`s that number. Without a
  `connectTo` the call SAYS the option is unavailable rather than omitting it.
  Never auto-bridge, and never place a call with no accept keypress.
- **`GET /calls/:id`** (record id or Twilio call SID) is how a caller learns the
  outcome: `accepted` false means nobody took it (no answer, no keypress, or a
  machine), `connected` says whether the bridge happened.
- **Flow legs** are Twilio-signed webhooks under `/webhooks/twilio/voice/*`
  (`answer` → `accept` → `connect` → `dial-status`, plus `status`). Each carries
  `?ref=<call record id>`; the row is inserted BEFORE the call is placed because
  Twilio fetches `answer` as soon as it connects. Twilio signs the full URL
  including that query string.
- **Cost.** Twilio bills voice per minute at a rate set by the destination, so
  costs-service publishes one catalogue name per band and the caller resolves it
  from the number it dialled (`src/lib/voice-pricing.ts`):
  `twilio-voice-outbound-minute-us`,
  `twilio-voice-outbound-minute-fr-landline`,
  `twilio-voice-outbound-minute-fr-mobile`. A destination with no published band
  is REFUSED with a 400 before dialling, never billed under a neighbouring band;
  the fix is a new costs-service row. Both legs are billed: the placed leg is
  declared at the `status` callback, the bridged leg at `dial-status`, each under
  its own destination's band, quantity = minutes (a started minute bills in full).
  `cost_declared` / `connect_cost_declared` keep a retried callback from
  declaring twice.
- **Code-owned channel config (NOT env):** the caller id (`+13159291895`, the
  only voice-enabled number on the account), the webhook paths, the
  signature-validation flag, and the keypress timeouts are constants in
  `src/lib/twilio-client.ts` / `src/routes/calls.ts`. Twilio creds come from
  key-service, same as SMS and WhatsApp.

## Key Patterns
- Zod schemas are the single source of truth for validation + OpenAPI generation
- Never edit openapi.json manually — it's auto-generated
- Runs-service integration is BLOCKING: create run → send SMS → record → add costs → complete run
- Webhook handler uses Twilio request validation for security
- All tables linked by messageSid (Twilio's message ID)
- Port 3011
