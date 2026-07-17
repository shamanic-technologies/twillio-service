/**
 * HTTP client for chat-service — the live production AI brain.
 *
 * Forwards a WhatsApp message to chat-service's agentic chat endpoint (POST
 * /chat), the exact same brain the dashboard's "Edit with AI" reaches (via
 * api-service /api/v1/chat). chat-service streams the response as Server-Sent
 * Events; this client consumes the stream, captures the session id, and
 * accumulates the assistant tokens into the final reply text.
 *
 * This service contains NO agent logic. The WhatsApp agent identity (system
 * prompt + tool list) lives entirely in chat-service as a CONFIG, selected here
 * by the code-owned `configKey` "whatsapp". chat-service owns model resolution,
 * the provider key, and the LLM cost declaration — we just pass the message +
 * identity headers + run id so the spend is metered against the sender's org.
 *
 * Live SSE contract (chat-service POST /chat — verified via api-registry):
 *   data: {"sessionId":"<uuid>"}             ← first frame, session to resume
 *   data: {"type":"thinking_start"|…}        ← optional reasoning frames, ignored
 *   data: {"type":"token","content":"…"}     ← streamed assistant text (accumulate)
 *   data: {"type":"tool_call", …}             ← ignored (chat-service runs the tool)
 *   data: {"type":"tool_result", …}           ← ignored
 *   data: {"type":"input_request", …}         ← optional, terminates the turn
 *   data: {"type":"buttons","buttons":[…]}    ← optional suggested actions
 *   data: {"type":"error","message":"…"}      ← turn failed
 *   data: "[DONE]"                             ← terminator
 */

const CHAT_SERVICE_URL = process.env.CHAT_SERVICE_URL;
const CHAT_SERVICE_API_KEY = process.env.CHAT_SERVICE_API_KEY;
// Code-owned: the chat-service config (system prompt + allowed tools) backing
// the WhatsApp agent. chat-service owns the config; we only reference it by key.
// Registered on chat-service via PUT /config (per-org) or PUT /platform-config.
const WHATSAPP_CHAT_CONFIG_KEY = "whatsapp";

export interface RunChatParams {
  message: string;
  orgId: string;
  userId: string;
  runId: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface RunChatResult {
  sessionId: string | null;
  reply: string;
}

/**
 * Parse a raw SSE buffer into an ordered list of decoded `data:` payloads.
 * Each SSE event is separated by a blank line; a payload is either a JSON object
 * or the literal string "[DONE]".
 */
export function parseSseEvents(raw: string): unknown[] {
  const events: unknown[] = [];
  for (const block of raw.split("\n\n")) {
    const dataLines = block
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n");
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch {
      events.push(payload);
    }
  }
  return events;
}

/**
 * Reduce decoded SSE events into { sessionId, reply }.
 */
export function reduceChatEvents(events: unknown[]): RunChatResult {
  let sessionId: string | null = null;
  let reply = "";
  for (const ev of events) {
    if (ev === "[DONE]") break;
    if (ev && typeof ev === "object") {
      const obj = ev as Record<string, unknown>;
      if (typeof obj.sessionId === "string") sessionId = obj.sessionId;
      if (obj.type === "token" && typeof obj.content === "string") {
        reply += obj.content;
      }
      if (obj.type === "error") {
        throw new Error(
          `chat-service turn failed: ${
            typeof obj.message === "string" ? obj.message : "unknown error"
          }`
        );
      }
    }
  }
  return { sessionId, reply: reply.trim() };
}

/**
 * Forward a message to the chat-service agent and return its reply.
 * Fails loud if chat-service is not configured or the request fails.
 */
export async function runChat(params: RunChatParams): Promise<RunChatResult> {
  if (!CHAT_SERVICE_URL || !CHAT_SERVICE_API_KEY) {
    throw new Error("CHAT_SERVICE_URL or CHAT_SERVICE_API_KEY not configured");
  }

  const res = await fetch(`${CHAT_SERVICE_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-api-key": CHAT_SERVICE_API_KEY,
      "x-org-id": params.orgId,
      "x-user-id": params.userId,
      "x-run-id": params.runId,
    },
    body: JSON.stringify({
      configKey: WHATSAPP_CHAT_CONFIG_KEY,
      message: params.message,
      // Omit (rather than send null) when there is no session to resume.
      ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      context: params.context,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`chat-service chat failed: ${res.status} ${body}`);
  }

  const raw = await res.text();
  return reduceChatEvents(parseSseEvents(raw));
}
