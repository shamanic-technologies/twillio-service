/**
 * HTTP client for agent-service (a.k.a. claude-agent-service).
 *
 * Forwards a message to the "dashboard-chat" (Foxy) agent and returns its reply.
 * agent-service streams the response as Server-Sent Events; this client consumes
 * the stream, captures the session id, and accumulates the assistant tokens into
 * the final reply text. It contains NO agent logic — the agent owns all of that.
 *
 * Live SSE contract (agent-service POST /agents/:agentName):
 *   data: {"sessionId":"<uuid>"}          ← first frame, session to resume
 *   data: {"type":"token","content":"…"}  ← streamed assistant text (accumulate)
 *   data: {"type":"tool_call", …}          ← ignored
 *   data: {"type":"tool_result", …}        ← ignored
 *   data: {"type":"buttons","buttons":[…]} ← optional suggested actions
 *   data: {"type":"error","message":"…"}   ← turn failed
 *   data: "[DONE]"                          ← terminator
 */

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL;
const AGENT_SERVICE_API_KEY = process.env.AGENT_SERVICE_API_KEY;
// The app whose platform Anthropic key backs dashboard-chat. Must match the
// appId the dashboard uses so key-service resolves the same app key.
const AGENT_APP_ID = process.env.AGENT_APP_ID || "dashboard-chat";

export interface RunDashboardChatParams {
  message: string;
  orgId: string;
  userId: string;
  runId: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface RunDashboardChatResult {
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
export function reduceAgentEvents(events: unknown[]): RunDashboardChatResult {
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
          `agent-service turn failed: ${
            typeof obj.message === "string" ? obj.message : "unknown error"
          }`
        );
      }
    }
  }
  return { sessionId, reply: reply.trim() };
}

/**
 * Forward a message to the dashboard-chat agent and return its reply.
 * Fails loud if agent-service is not configured or the request fails.
 */
export async function runDashboardChat(
  params: RunDashboardChatParams
): Promise<RunDashboardChatResult> {
  if (!AGENT_SERVICE_URL || !AGENT_SERVICE_API_KEY) {
    throw new Error(
      "AGENT_SERVICE_URL or AGENT_SERVICE_API_KEY not configured"
    );
  }

  const res = await fetch(`${AGENT_SERVICE_URL}/agents/dashboard-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "x-api-key": AGENT_SERVICE_API_KEY,
      "x-org-id": params.orgId,
      "x-user-id": params.userId,
      "x-run-id": params.runId,
    },
    body: JSON.stringify({
      message: params.message,
      sessionId: params.sessionId,
      appId: AGENT_APP_ID,
      runId: params.runId,
      keySource: "app",
      orgId: params.orgId,
      userId: params.userId,
      context: params.context,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `agent-service dashboard-chat failed: ${res.status} ${body}`
    );
  }

  const raw = await res.text();
  return reduceAgentEvents(parseSseEvents(raw));
}
