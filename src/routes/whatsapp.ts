import { Router, Request, Response } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { twilioSendings, whatsappUsers, whatsappSessions } from "../db/schema";
import {
  sendWhatsApp,
  getWhatsAppFromNumber,
  normalizeWhatsAppPhone,
  validateWebhookSignature,
} from "../lib/twilio-client";
import { runChat } from "../lib/chat-client";
import { resolveOrProvisionAccountByPhone } from "../lib/client-client";
import { createRun, updateRun, addCosts } from "../lib/runs-client";
import { SendWhatsAppRequestSchema } from "../schemas";

const router = Router();

// ─── Code-owned WhatsApp channel config (not Railway env) ───────────────────
// The inbound webhook route path. The exact URL Twilio signs its webhook (and
// status-callback) requests with is this path joined onto the service public URL.
const WHATSAPP_WEBHOOK_PATH = "/webhooks/twilio/whatsapp";
// Validate Twilio webhook signatures by default.
const VALIDATE_WHATSAPP_WEBHOOK = true;
// Per-message Twilio WhatsApp fee — byte-equal to the costs-service catalog row.
const WHATSAPP_COST_NAME = "twilio-whatsapp-message";

/**
 * Build the exact public URL Twilio signs a request to `path` with, by joining
 * the service public URL (Railway) with the route path. Fails loud if the public
 * URL is not configured — signature validation cannot be trusted without it.
 */
function buildWebhookUrl(path: string): string {
  const base = process.env.TWILIO_SERVICE_PUBLIC_URL;
  if (!base) throw new Error("TWILIO_SERVICE_PUBLIC_URL not configured");
  return `${base.replace(/\/+$/, "")}${path}`;
}

// Twilio delivers WhatsApp webhooks as URL-encoded form data.
router.use(WHATSAPP_WEBHOOK_PATH, express.urlencoded({ extended: false }));

// WhatsApp uses its own lightweight markup (single *bold*, _italic_, ~strike~),
// NOT full markdown. The chat-service agent emits markdown (**bold**, headings,
// [text](url)); convert to WhatsApp markup so users don't see stray ** and #.
function toWhatsAppText(md: string): string {
  return md
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** / -> *bold*
    .replace(/__(.+?)__/g, "*$1*") // __bold__ -> *bold*
    .replace(/^#{1,6}\s+(.*)$/gm, "*$1*") // # Heading -> *Heading*
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)"); // [text](url) -> text (url)
}

export interface InboundWhatsAppPayload {
  from: string; // Twilio "From", e.g. "whatsapp:+14155551234"
  to?: string; // Twilio "To" — the exact channel address Twilio delivered to,
  // e.g. "whatsapp:+17372324091". Reply MUST go back FROM this address, else
  // Twilio 63007 "could not find a Channel with the specified From address".
  body: string;
  messageSid: string;
  waId?: string;
  profileName?: string;
}

/**
 * Core inbound orchestration (exported for testing):
 *   resolve/provision account → track run → forward to chat-service agent →
 *   persist session → reply over WhatsApp → complete run.
 *
 * This is the thin adapter: it contains no agent logic and no Clerk/credit
 * provisioning — it bridges the WhatsApp message to chat-service (the same
 * agentic brain the dashboard uses) and delivers the reply back to the sender.
 */
export async function handleInboundWhatsApp(
  payload: InboundWhatsAppPayload
): Promise<void> {
  const phone = normalizeWhatsAppPhone(payload.from);

  // 1. Resolve the sender to a platform account (provision if unknown).
  const existing = await db.query.whatsappUsers.findFirst({
    where: eq(whatsappUsers.phone, phone),
  });

  let orgId: string;
  let userId: string;

  if (existing && existing.isActive) {
    orgId = existing.orgId;
    userId = existing.userId;
  } else {
    const account = await resolveOrProvisionAccountByPhone({
      phone,
      profileName: payload.profileName,
      source: "whatsapp",
    });
    orgId = account.orgId;
    userId = account.userId;

    // Cache the mapping so future messages resolve instantly.
    await db
      .insert(whatsappUsers)
      .values({
        phone,
        waId: payload.waId,
        profileName: payload.profileName,
        orgId,
        userId,
      })
      .onConflictDoUpdate({
        target: whatsappUsers.phone,
        set: {
          orgId,
          userId,
          waId: payload.waId,
          profileName: payload.profileName,
          isActive: true,
          updatedAt: new Date(),
        },
      });
  }

  // 2. Track a run for this message.
  const run = await createRun({
    orgId,
    userId,
    serviceName: "twilio-service",
    taskName: "whatsapp-inbound",
  });

  try {
    // 3. Resume the conversation session, if any.
    const session = await db.query.whatsappSessions.findFirst({
      where: eq(whatsappSessions.phone, phone),
    });

    // 4. Forward to the chat-service agent (same brain as the dashboard) and
    //    get its reply. Scoped to the resolved org/user; the run id lets
    //    chat-service meter the LLM cost against this org's balance.
    const agentResult = await runChat({
      message: payload.body,
      orgId,
      userId,
      runId: run.id,
      sessionId: session?.sessionId,
      context: {
        channel: "whatsapp",
        phone,
        messageSid: payload.messageSid,
        profileName: payload.profileName,
      },
    });

    // 5. Persist the (possibly new) chat-service session id for continuity.
    if (agentResult.sessionId) {
      if (session) {
        await db
          .update(whatsappSessions)
          .set({ sessionId: agentResult.sessionId, updatedAt: new Date() })
          .where(eq(whatsappSessions.phone, phone));
      } else {
        await db.insert(whatsappSessions).values({
          phone,
          sessionId: agentResult.sessionId,
        });
      }
    }

    // 6. Deliver the agent's reply back over WhatsApp. Reply FROM the exact
    //    channel address Twilio delivered the inbound message TO (the webhook
    //    "To") — that's the live sender (sandbox now, prod sender later). Using
    //    a hardcoded constant that doesn't match the delivering channel yields
    //    Twilio 63007. Fall back to the code constant only if "To" is absent.
    const replyFrom = payload.to
      ? normalizeWhatsAppPhone(payload.to)
      : getWhatsAppFromNumber();

    if (agentResult.reply) {
      const replyText = toWhatsAppText(agentResult.reply);
      const sendResult = await sendWhatsApp({
        from: replyFrom,
        to: phone,
        body: replyText,
      });

      if (sendResult.success && sendResult.messageSid) {
        await db.insert(twilioSendings).values({
          messageSid: sendResult.messageSid,
          channel: "whatsapp",
          orgId,
          userId,
          runId: run.id,
          from: replyFrom,
          to: phone,
          body: replyText,
          status: sendResult.status || "queued",
          numSegments: sendResult.numSegments
            ? parseInt(sendResult.numSegments, 10)
            : null,
        });
      }
    }

    // 7. Complete the run.
    await updateRun(run.id, "completed", { orgId, userId });
  } catch (err) {
    await updateRun(
      run.id,
      "failed",
      { orgId, userId },
      err instanceof Error ? err.message : undefined
    ).catch(console.error);
    throw err;
  }
}

// ─── POST /webhooks/twilio/whatsapp ─────────────────────────────────────────
// Inbound WhatsApp messages from Twilio. No X-API-Key (Twilio-signed); returns
// an empty TwiML response immediately and processes the turn out-of-band (the
// reply is delivered via the Twilio REST API, not via this TwiML response).

router.post("/webhooks/twilio/whatsapp", async (req: Request, res: Response) => {
  try {
    // Twilio signature validation (on by default). Twilio signs the request
    // using the exact public URL it called — derive it from the service public
    // URL + route path, not the inbound Host header.
    if (VALIDATE_WHATSAPP_WEBHOOK) {
      const signature = req.header("X-Twilio-Signature") || "";
      const url = buildWebhookUrl(WHATSAPP_WEBHOOK_PATH);
      const valid = await validateWebhookSignature(
        signature,
        url,
        req.body || {}
      );
      if (!valid) {
        return res.status(403).type("text/xml").send("<Response></Response>");
      }
    }

    const From = req.body?.From as string | undefined;
    const To = req.body?.To as string | undefined;
    const Body = req.body?.Body as string | undefined;
    const MessageSid = req.body?.MessageSid as string | undefined;
    const WaId = req.body?.WaId as string | undefined;
    const ProfileName = req.body?.ProfileName as string | undefined;

    // Ack Twilio immediately with empty TwiML (reply is sent via REST).
    res.status(200).type("text/xml").send("<Response></Response>");

    if (!From || !Body || !MessageSid) {
      return;
    }

    // Fire-and-forget: never block the webhook response on the agent turn.
    handleInboundWhatsApp({
      from: From,
      to: To,
      body: Body,
      messageSid: MessageSid,
      waId: WaId,
      profileName: ProfileName,
    }).catch((err) => {
      console.error("WhatsApp inbound processing error:", err);
    });
  } catch (err) {
    console.error("POST /webhooks/twilio/whatsapp error:", err);
    if (!res.headersSent) {
      res.status(200).type("text/xml").send("<Response></Response>");
    }
  }
});

// ─── POST /send/whatsapp ────────────────────────────────────────────────────
// Outbound WhatsApp send. Service-authed (X-API-Key + identity headers) — usable
// by any service to push a WhatsApp message to a user. Mirrors the SMS /send
// path: create run → send → record → cost → complete run.

router.post("/send/whatsapp", async (req: Request, res: Response) => {
  try {
    const parsed = SendWhatsAppRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        message: parsed.error.issues.map((e) => e.message).join(", "),
      });
    }

    const data = parsed.data;
    const orgId = res.locals.orgId as string;
    const userId = res.locals.userId as string;

    let runId: string | undefined;
    try {
      const run = await createRun({
        orgId,
        userId,
        serviceName: "twilio-service",
        taskName: "whatsapp-send",
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

    const fromNumber = getWhatsAppFromNumber();
    const result = await sendWhatsApp({
      from: fromNumber,
      to: data.to,
      body: data.body,
      statusCallback: data.statusCallback,
    });

    if (!result.success) {
      if (runId) {
        await updateRun(runId, "failed", { orgId, userId }, result.errorMessage).catch(
          console.error
        );
      }
      return res.status(500).json({
        error: "Failed to send WhatsApp message",
        message: result.errorMessage,
      });
    }

    const [record] = await db
      .insert(twilioSendings)
      .values({
        messageSid: result.messageSid!,
        channel: "whatsapp",
        orgId,
        userId,
        runId: data.parentRunId,
        brandId: data.brandId,
        campaignId: data.campaignId,
        from: normalizeWhatsAppPhone(fromNumber),
        to: normalizeWhatsAppPhone(data.to),
        body: data.body,
        status: result.status || "queued",
        numSegments: result.numSegments
          ? parseInt(result.numSegments, 10)
          : null,
      })
      .returning({ id: twilioSendings.id });

    if (runId) {
      try {
        // The Twilio WhatsApp per-message fee (platform-billed). The cost name
        // is code-owned and byte-equal to the costs-service catalog row; the LLM
        // spend is declared separately by chat-service.
        await addCosts(
          runId,
          [{ costName: WHATSAPP_COST_NAME, costSource: "platform", quantity: 1 }],
          { orgId, userId }
        );
        await updateRun(runId, "completed", { orgId, userId });
      } catch (err) {
        console.error("Failed to add costs/complete run:", err);
      }
    }

    return res.status(200).json({
      success: true,
      messageSid: result.messageSid,
      status: result.status,
      numSegments: result.numSegments,
      recordId: record.id,
    });
  } catch (err) {
    console.error("POST /send/whatsapp error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
