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
  CallScriptInput,
} from "../lib/voice-script";
import { PlaceCallRequestSchema } from "../schemas";

const router = Router();

// ─── Code-owned voice channel config (not env) ──────────────────────────────

const VOICE_WEBHOOK_PREFIX = "/webhooks/twilio/voice";
const ANSWER_PATH = `${VOICE_WEBHOOK_PREFIX}/answer`;
const ACCEPT_PATH = `${VOICE_WEBHOOK_PREFIX}/accept`;
const CONNECT_PATH = `${VOICE_WEBHOOK_PREFIX}/connect`;
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

function scriptInput(call: typeof twilioCalls.$inferSelect): CallScriptInput {
  return {
    reply: {
      name: call.replyName,
      company: call.replyCompany ?? undefined,
      message: call.replyMessage,
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

    vr.say(call.detail);

    const input = scriptInput(call);

    if (call.connectTo) {
      const gather = vr.gather({
        numDigits: 1,
        timeout: KEYPRESS_TIMEOUT_SECONDS,
        action: legUrl(CONNECT_PATH, call.id),
        method: "POST",
      });
      gather.pause({ length: 1 });
      gather.say(buildConnectPrompt(input));
      vr.say("No key was pressed. Goodbye.");
    } else {
      // No number to connect to: say so rather than silently ending.
      vr.say(buildNoConnectLine(input));
      vr.say("Goodbye.");
    }

    vr.hangup();
    return sendTwiml(res, vr);
  } catch (err) {
    console.error("POST voice/accept error:", err);
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
    dial.number(call.connectTo);

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
