import { Router, Request, Response } from "express";
import express from "express";
import { eq, or } from "drizzle-orm";
import twilio from "twilio";
import { db } from "../db";
import { twilioCalls } from "../db/schema";
import {
  placeCall,
  getVoiceFromNumber,
  validateWebhookSignature,
} from "../lib/twilio-client";
import { createRun, updateRun, addCosts } from "../lib/runs-client";
import { buildWebhookUrl } from "../lib/webhook-url";
import {
  resolveVoiceCostName,
  billedMinutes,
  normalizePhone,
} from "../lib/voice-pricing";
import {
  buildSummary,
  buildDetail,
  buildConnectPrompt,
  buildNoConnectLine,
  buildIdentityLine,
  buildShortIdentityLine,
  buildMenuPrompt,
  buildPriorMessageLine,
  buildHearOption,
  CallScriptInput,
  PriorMessage,
} from "../lib/voice-script";
import { PlaceCallRequestSchema } from "../schemas";

const router = Router();

// ─── Code-owned voice channel config (not env) ──────────────────────────────

const VOICE_WEBHOOK_PREFIX = "/webhooks/twilio/voice";
const ANSWER_PATH = `${VOICE_WEBHOOK_PREFIX}/answer`;
const ACCEPT_PATH = `${VOICE_WEBHOOK_PREFIX}/accept`;
const CONNECT_PATH = `${VOICE_WEBHOOK_PREFIX}/connect`;
const MENU_PATH = `${VOICE_WEBHOOK_PREFIX}/menu`;
const DIAL_STATUS_PATH = `${VOICE_WEBHOOK_PREFIX}/dial-status`;
const STATUS_PATH = `${VOICE_WEBHOOK_PREFIX}/status`;

// Validate Twilio webhook signatures by default.
const VALIDATE_VOICE_WEBHOOK = true;
// Seconds Twilio waits for each keypress before giving up on the call.
const KEYPRESS_TIMEOUT_SECONDS = 10;
// Seconds the bridged leg rings before we give up on it.
const CONNECT_RING_TIMEOUT_SECONDS = 30;
// Twilio call statuses that end the call.
const TERMINAL_CALL_STATUSES = [
  "completed",
  "busy",
  "no-answer",
  "failed",
  "canceled",
];

// Twilio delivers voice webhooks as URL-encoded form data.
router.use(VOICE_WEBHOOK_PREFIX, express.urlencoded({ extended: false }));

/** The exact URL Twilio will call (and sign) for a leg of the flow. */
function legUrl(path: string, ref: string): string {
  return buildWebhookUrl(`${path}?ref=${encodeURIComponent(ref)}`);
}

/**
 * The menu leg's URL. The walk position through the thread rides this query
 * string — there is no cursor column and no per-leg state anywhere else.
 */
function menuUrl(ref: string, index: number): string {
  return buildWebhookUrl(
    `${MENU_PATH}?ref=${encodeURIComponent(ref)}&i=${index}`
  );
}

/**
 * The walk position a menu leg was reached at. Anything out of range or
 * malformed reads as "past the end of the thread", which lands on the
 * connect-only menu rather than failing the leg.
 */
function menuIndex(raw: unknown): number {
  const parsed = parseInt(String(raw ?? "0"), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return Number.MAX_SAFE_INTEGER;
  return parsed;
}

function emptyTwiml(res: Response, status = 200) {
  return res.status(status).type("text/xml").send("<Response></Response>");
}

function sendTwiml(res: Response, vr: twilio.twiml.VoiceResponse) {
  return res.status(200).type("text/xml").send(vr.toString());
}

/**
 * Validate the Twilio signature on a voice webhook. Twilio signs the full URL
 * including the ?ref= query string, so it is rebuilt exactly as it was handed
 * over when the call was placed.
 */
async function voiceSignatureValid(
  req: Request,
  path: string,
  ref: string
): Promise<boolean> {
  if (!VALIDATE_VOICE_WEBHOOK) return true;
  const signature = req.header("X-Twilio-Signature") || "";
  return validateWebhookSignature(signature, legUrl(path, ref), req.body || {});
}

/**
 * The menu leg carries the walk position in its URL, and Twilio signs the URL it
 * actually called. Rebuilding that URL from the PARSED index cannot reproduce a
 * malformed one, so the check is made against the query string AS RECEIVED —
 * otherwise a bad `i` fails the signature instead of landing on the
 * connect-only menu.
 */
async function menuSignatureValid(req: Request): Promise<boolean> {
  if (!VALIDATE_VOICE_WEBHOOK) return true;
  const signature = req.header("X-Twilio-Signature") || "";
  return validateWebhookSignature(
    signature,
    buildWebhookUrl(req.originalUrl),
    req.body || {}
  );
}

function priorMessages(
  call: typeof twilioCalls.$inferSelect
): PriorMessage[] {
  return Array.isArray(call.priorMessages) ? call.priorMessages : [];
}

function scriptInput(call: typeof twilioCalls.$inferSelect): CallScriptInput {
  return {
    reply: {
      name: call.replyName,
      company: call.replyCompany ?? undefined,
      message: call.replyMessage,
      firstName: call.replyFirstName ?? undefined,
      lastName: call.replyLastName ?? undefined,
      title: call.replyTitle ?? undefined,
      city: call.replyCity ?? undefined,
      state: call.replyState ?? undefined,
      country: call.replyCountry ?? undefined,
    },
    brandName: call.brandName ?? undefined,
    connectName: call.connectName ?? undefined,
    hasConnect: Boolean(call.connectTo),
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a path parameter can be one of our record ids (a uuid column). */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Where-clause for a call lookup by record id or Twilio call SID. `id` is a
 * uuid column, so comparing a Twilio SID against it makes Postgres fail the
 * cast and the whole lookup 500s — only ask about the record id when the
 * parameter can actually be one.
 */
export function callLookupWhere(id: string) {
  return isUuid(id)
    ? or(eq(twilioCalls.callSid, id), eq(twilioCalls.id, id))
    : eq(twilioCalls.callSid, id);
}

/** Load the call row a webhook leg refers to, or null. */
async function loadCall(ref: string | undefined) {
  // A ref that is not one of our record ids cannot match the uuid column, and
  // asking Postgres to cast it fails the whole query.
  if (!ref || !isUuid(ref)) return null;
  const call = await db.query.twilioCalls.findFirst({
    where: eq(twilioCalls.id, ref),
  });
  return call ?? null;
}

// ─── POST /calls ────────────────────────────────────────────────────────────
// Request an outbound call. The person rung hears why they are being called and
// must press 1 to take it; only then do they hear the detail, and only then (and
// only when a number to connect to was supplied) are they offered a second
// keypress that bridges them to that person.

router.post("/calls", async (req: Request, res: Response) => {
  try {
    const parsed = PlaceCallRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        message: parsed.error.issues.map((e) => e.message).join(", "),
      });
    }

    const data = parsed.data;
    const orgId = res.locals.orgId as string;
    const userId = res.locals.userId as string;

    const to = normalizePhone(data.to);
    const connectTo = data.connectTo ? normalizePhone(data.connectTo) : null;

    // Resolve the catalogue cost name for every leg BEFORE dialling. A
    // destination with no published band cannot have its minutes declared, so
    // the call is refused rather than billed under a neighbouring band.
    const costName = resolveVoiceCostName(to);
    if (!costName) {
      return res.status(400).json({
        error: "Unsupported destination",
        message: `No published voice cost band for ${to}. A new destination needs a costs-service catalogue row before it can be called.`,
      });
    }

    let connectCostName: string | null = null;
    if (connectTo) {
      connectCostName = resolveVoiceCostName(connectTo);
      if (!connectCostName) {
        return res.status(400).json({
          error: "Unsupported connect destination",
          message: `No published voice cost band for ${connectTo}. A new destination needs a costs-service catalogue row before it can be called.`,
        });
      }
    }

    // Track the run (BLOCKING — the call's cost hangs off it).
    let runId: string;
    try {
      const run = await createRun({
        orgId,
        userId,
        serviceName: "twilio-service",
        taskName: "place-call",
        parentRunId: data.parentRunId,
        brandId: data.brandId,
        campaignId: data.campaignId,
      });
      runId = run.id;
    } catch (err) {
      console.error("Failed to create run:", err);
      return res.status(500).json({
        error: "Failed to create run in runs-service",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }

    const from = getVoiceFromNumber();
    const input: CallScriptInput = {
      reply: data.reply,
      brandName: data.brandName,
      connectName: data.connectName,
      hasConnect: Boolean(connectTo),
    };
    const summary = buildSummary(input);
    const detail = buildDetail(input);

    // Insert BEFORE dialling: Twilio fetches the answer webhook as soon as the
    // call connects, and that leg needs this row to exist.
    const [record] = await db
      .insert(twilioCalls)
      .values({
        orgId,
        userId,
        runId,
        parentRunId: data.parentRunId,
        brandId: data.brandId,
        campaignId: data.campaignId,
        from,
        to,
        connectTo,
        connectName: data.connectName,
        brandName: data.brandName,
        replyName: data.reply.name,
        replyCompany: data.reply.company,
        replyMessage: data.reply.message,
        replyFirstName: data.reply.firstName,
        replyLastName: data.reply.lastName,
        replyTitle: data.reply.title,
        replyCity: data.reply.city,
        replyState: data.reply.state,
        replyCountry: data.reply.country,
        priorMessages: data.priorMessages,
        summary,
        detail,
        costName,
        connectCostName,
        status: "queued",
      })
      .returning();

    const result = await placeCall({
      from,
      to,
      url: legUrl(ANSWER_PATH, record.id),
      statusCallback: legUrl(STATUS_PATH, record.id),
    });

    if (!result.success) {
      await db
        .update(twilioCalls)
        .set({
          status: "failed",
          errorCode: result.errorCode,
          errorMessage: result.errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(twilioCalls.id, record.id));
      await updateRun(
        runId,
        "failed",
        { orgId, userId },
        result.errorMessage
      ).catch(console.error);

      return res.status(502).json({
        error: "Failed to place call",
        message: result.errorMessage,
        callId: record.id,
      });
    }

    await db
      .update(twilioCalls)
      .set({
        callSid: result.callSid,
        status: result.status || "queued",
        updatedAt: new Date(),
      })
      .where(eq(twilioCalls.id, record.id));

    return res.status(200).json({
      success: true,
      callId: record.id,
      callSid: result.callSid,
      status: result.status,
      costName,
      connectOffered: Boolean(connectTo),
    });
  } catch (err) {
    console.error("POST /calls error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─── GET /calls/:id ─────────────────────────────────────────────────────────
// Read a call by its record id or its Twilio call SID. `accepted` is what tells
// a taken call from one nobody picked up, nobody accepted, or a machine took.

router.get("/calls/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const call = await db.query.twilioCalls.findFirst({
      where: callLookupWhere(id),
    });

    if (!call) {
      return res.status(404).json({ error: "Call not found" });
    }

    return res.status(200).json({ call });
  } catch (err) {
    console.error("GET /calls/:id error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─── POST /webhooks/twilio/voice/answer ─────────────────────────────────────
// The call was answered. Play the summary and ask for the accept keypress, and
// nothing more: a voicemail hears only this and never becomes a taken call.

router.post(ANSWER_PATH, async (req: Request, res: Response) => {
  try {
    const ref = req.query.ref as string | undefined;
    if (!(await voiceSignatureValid(req, ANSWER_PATH, ref || ""))) {
      return emptyTwiml(res, 403);
    }

    const call = await loadCall(ref);
    if (!call) {
      const vr = new twilio.twiml.VoiceResponse();
      vr.say("Sorry, this call is no longer available. Goodbye.");
      vr.hangup();
      return sendTwiml(res, vr);
    }

    await db
      .update(twilioCalls)
      .set({ status: "in-progress", updatedAt: new Date() })
      .where(eq(twilioCalls.id, call.id));

    const vr = new twilio.twiml.VoiceResponse();
    const gather = vr.gather({
      numDigits: 1,
      timeout: KEYPRESS_TIMEOUT_SECONDS,
      action: legUrl(ACCEPT_PATH, call.id),
      method: "POST",
    });
    gather.say(call.summary);
    // Repeat once inside the same gather, so a slow listener still gets a shot.
    gather.pause({ length: 1 });
    gather.say("Press 1 to take this call.");
    // Reached only when no key was pressed.
    vr.say("No key was pressed. Goodbye.");
    vr.hangup();

    return sendTwiml(res, vr);
  } catch (err) {
    console.error("POST voice/answer error:", err);
    return emptyTwiml(res, 500);
  }
});

// ─── POST /webhooks/twilio/voice/accept ─────────────────────────────────────
// The accept keypress. Only "1" takes the call; anything else leaves the call
// un-taken, which is what the caller reads back as "nobody took it".

router.post(ACCEPT_PATH, async (req: Request, res: Response) => {
  try {
    const ref = req.query.ref as string | undefined;
    if (!(await voiceSignatureValid(req, ACCEPT_PATH, ref || ""))) {
      return emptyTwiml(res, 403);
    }

    const call = await loadCall(ref);
    if (!call) return emptyTwiml(res);

    const digits = (req.body?.Digits as string | undefined) || "";
    const vr = new twilio.twiml.VoiceResponse();

    if (digits !== "1") {
      vr.say("No problem. Goodbye.");
      vr.hangup();
      return sendTwiml(res, vr);
    }

    await db
      .update(twilioCalls)
      .set({ accepted: true, acceptedAt: new Date(), updatedAt: new Date() })
      .where(eq(twilioCalls.id, call.id));

    const input = scriptInput(call);
    const prior = priorMessages(call);

    // The reply, then the identity in full, then the menu. The identity line is
    // null when nothing arrived beyond the name and company the reply detail
    // already spoke, so a call placed without those fields sounds as it always
    // did.
    const identity = buildIdentityLine(input);

    if (!call.connectTo) {
      // No number to connect to: say so rather than silently ending. The walk
      // back through the thread is still offered — the context is worth having
      // even when the bridge is not on the table.
      vr.say(call.detail);
      if (identity) vr.say(identity);
      vr.say(buildNoConnectLine(input));
      if (!buildHearOption(prior, 0)) {
        vr.say("Goodbye.");
        vr.hangup();
        return sendTwiml(res, vr);
      }
    }

    // Everything spoken sits INSIDE the gather, so pressing a key mid-read acts
    // on it immediately instead of making the listener sit through the rest.
    const gather = vr.gather({
      numDigits: 1,
      timeout: KEYPRESS_TIMEOUT_SECONDS,
      action: menuUrl(call.id, 0),
      method: "POST",
    });
    if (call.connectTo) {
      gather.say(call.detail);
      if (identity) gather.say(identity);
      gather.pause({ length: 1 });
    }
    gather.say(buildMenuPrompt(input, prior, 0));
    vr.say("No key was pressed. Goodbye.");

    vr.hangup();
    return sendTwiml(res, vr);
  } catch (err) {
    console.error("POST voice/accept error:", err);
    return emptyTwiml(res, 500);
  }
});

/**
 * Mark the call bridged and dial. Shared by the connect leg and the menu leg, so
 * pressing 1 anywhere in the walk reaches exactly the same bridge.
 */
async function bridge(
  call: typeof twilioCalls.$inferSelect,
  vr: twilio.twiml.VoiceResponse
): Promise<void> {
  await db
    .update(twilioCalls)
    .set({ connected: true, connectedAt: new Date(), updatedAt: new Date() })
    .where(eq(twilioCalls.id, call.id));

  vr.say("Connecting you now.");
  const dial = vr.dial({
    callerId: call.from,
    timeout: CONNECT_RING_TIMEOUT_SECONDS,
    action: legUrl(DIAL_STATUS_PATH, call.id),
    method: "POST",
  });
  dial.number(call.connectTo as string);
}

// ─── POST /webhooks/twilio/voice/menu ───────────────────────────────────────
// The menu that walks backwards through the thread. `i` is the position in
// `priorMessages` the menu was offering: 1 connects, 2 reads that message and
// replays the menu one step further back. Nothing else acts, exactly as before.

router.post(MENU_PATH, async (req: Request, res: Response) => {
  try {
    const ref = req.query.ref as string | undefined;
    const index = menuIndex(req.query.i);
    if (!(await menuSignatureValid(req))) {
      return emptyTwiml(res, 403);
    }

    const call = await loadCall(ref);
    if (!call) return emptyTwiml(res);

    const digits = (req.body?.Digits as string | undefined) || "";
    const vr = new twilio.twiml.VoiceResponse();
    const input = scriptInput(call);
    const prior = priorMessages(call);

    if (digits === "1" && call.connectTo) {
      await bridge(call, vr);
      return sendTwiml(res, vr);
    }

    const line = digits === "2" ? buildPriorMessageLine(prior, index) : null;
    if (!line) {
      // Either a key we do not act on, or nothing earlier left to read.
      vr.say(digits === "2" ? "There is nothing earlier in this thread." : "Okay. Goodbye.");
      vr.hangup();
      return sendTwiml(res, vr);
    }

    const next = index + 1;
    const hasMore = Boolean(buildHearOption(prior, next));
    if (!call.connectTo && !hasMore) {
      // Nothing left to offer: read the message out and end rather than open a
      // gather no key can usefully answer.
      vr.say(line);
      vr.say("There is nothing earlier in this thread. Goodbye.");
      vr.hangup();
      return sendTwiml(res, vr);
    }

    const gather = vr.gather({
      numDigits: 1,
      timeout: KEYPRESS_TIMEOUT_SECONDS,
      action: menuUrl(call.id, next),
      method: "POST",
    });
    // The message sits inside the gather: pressing 1 mid-read connects at once.
    gather.say(line);
    gather.say(buildShortIdentityLine(input));
    gather.pause({ length: 1 });
    gather.say(buildMenuPrompt(input, prior, next));
    vr.say("No key was pressed. Goodbye.");
    vr.hangup();

    return sendTwiml(res, vr);
  } catch (err) {
    console.error("POST voice/menu error:", err);
    return emptyTwiml(res, 500);
  }
});

// ─── POST /webhooks/twilio/voice/connect ────────────────────────────────────
// The second, deliberate keypress. Only "1" bridges the two people.

router.post(CONNECT_PATH, async (req: Request, res: Response) => {
  try {
    const ref = req.query.ref as string | undefined;
    if (!(await voiceSignatureValid(req, CONNECT_PATH, ref || ""))) {
      return emptyTwiml(res, 403);
    }

    const call = await loadCall(ref);
    if (!call) return emptyTwiml(res);

    const digits = (req.body?.Digits as string | undefined) || "";
    const vr = new twilio.twiml.VoiceResponse();

    if (digits !== "1" || !call.connectTo) {
      vr.say("Okay, not connecting. Goodbye.");
      vr.hangup();
      return sendTwiml(res, vr);
    }

    await bridge(call, vr);
    return sendTwiml(res, vr);
  } catch (err) {
    console.error("POST voice/connect error:", err);
    return emptyTwiml(res, 500);
  }
});

// ─── POST /webhooks/twilio/voice/dial-status ────────────────────────────────
// The bridged leg finished. Twilio bills it separately from the leg we placed,
// so its minutes are declared under the band of the number we bridged to.

router.post(DIAL_STATUS_PATH, async (req: Request, res: Response) => {
  try {
    const ref = req.query.ref as string | undefined;
    if (!(await voiceSignatureValid(req, DIAL_STATUS_PATH, ref || ""))) {
      return emptyTwiml(res, 403);
    }

    const call = await loadCall(ref);
    if (!call) return emptyTwiml(res);

    const rawDuration = req.body?.DialCallDuration as string | undefined;
    const seconds = rawDuration ? parseInt(rawDuration, 10) : 0;
    const minutes = billedMinutes(Number.isNaN(seconds) ? 0 : seconds);

    await db
      .update(twilioCalls)
      .set({
        connectDurationSeconds: Number.isNaN(seconds) ? 0 : seconds,
        connectBilledMinutes: minutes,
        updatedAt: new Date(),
      })
      .where(eq(twilioCalls.id, call.id));

    // Declare the bridged leg's minutes once. A retried callback finds the flag
    // already set and does not double-declare.
    if (
      minutes > 0 &&
      call.runId &&
      call.connectCostName &&
      !call.connectCostDeclared
    ) {
      await addCosts(
        call.runId,
        [
          {
            costName: call.connectCostName,
            costSource: "platform",
            quantity: minutes,
          },
        ],
        { orgId: call.orgId, userId: call.userId }
      );
      await db
        .update(twilioCalls)
        .set({ connectCostDeclared: true, updatedAt: new Date() })
        .where(eq(twilioCalls.id, call.id));
    }

    const vr = new twilio.twiml.VoiceResponse();
    vr.hangup();
    return sendTwiml(res, vr);
  } catch (err) {
    // A cost that cannot be declared fails loud: Twilio sees the 500 and the
    // minutes are not silently dropped.
    console.error("POST voice/dial-status error:", err);
    return emptyTwiml(res, 500);
  }
});

// ─── POST /webhooks/twilio/voice/status ─────────────────────────────────────
// Terminal call status. Records the outcome, declares the placed leg's minutes,
// and closes the run.

router.post(STATUS_PATH, async (req: Request, res: Response) => {
  try {
    const ref = req.query.ref as string | undefined;
    if (!(await voiceSignatureValid(req, STATUS_PATH, ref || ""))) {
      return emptyTwiml(res, 403);
    }

    const call = await loadCall(ref);
    if (!call) return emptyTwiml(res);

    const callStatus = (req.body?.CallStatus as string | undefined) || "";
    const rawDuration = req.body?.CallDuration as string | undefined;
    const seconds = rawDuration ? parseInt(rawDuration, 10) : 0;
    const safeSeconds = Number.isNaN(seconds) ? 0 : seconds;
    const minutes = billedMinutes(safeSeconds);
    const isTerminal = TERMINAL_CALL_STATUSES.includes(callStatus);

    await db
      .update(twilioCalls)
      .set({
        status: callStatus || call.status,
        durationSeconds: safeSeconds,
        billedMinutes: minutes,
        completedAt: isTerminal ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(twilioCalls.id, call.id));

    if (!isTerminal) return emptyTwiml(res);

    if (minutes > 0 && call.runId && !call.costDeclared) {
      await addCosts(
        call.runId,
        [
          {
            costName: call.costName,
            costSource: "platform",
            quantity: minutes,
          },
        ],
        { orgId: call.orgId, userId: call.userId }
      );
      await db
        .update(twilioCalls)
        .set({ costDeclared: true, updatedAt: new Date() })
        .where(eq(twilioCalls.id, call.id));
    }

    if (call.runId) {
      // The run is this service's work of placing the call. A call nobody took
      // is a completed run with `accepted` false, not a failed one; only Twilio
      // failing to carry the call is a failed run.
      await updateRun(
        call.runId,
        callStatus === "failed" ? "failed" : "completed",
        { orgId: call.orgId, userId: call.userId },
        callStatus === "failed" ? "Twilio reported the call as failed" : undefined
      );
    }

    return emptyTwiml(res);
  } catch (err) {
    // Fail loud rather than acknowledge a status we could not fully record.
    console.error("POST voice/status error:", err);
    return emptyTwiml(res, 500);
  }
});

export default router;
