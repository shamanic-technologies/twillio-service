import { Router, Request, Response } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { twilioSendings, twilioStatusUpdates } from "../db/schema";

const router = Router();

// Twilio sends webhooks as URL-encoded form data
router.use("/webhooks/twilio", express.urlencoded({ extended: false }));

// ─── POST /webhooks/twilio/status ──────────────────────────────────────────

router.post(
  "/webhooks/twilio/status",
  async (req: Request, res: Response) => {
    try {
      const {
        MessageSid,
        MessageStatus,
        ErrorCode,
        ErrorMessage,
      } = req.body;

      if (!MessageSid || !MessageStatus) {
        return res
          .status(400)
          .type("text/xml")
          .send("<Response></Response>");
      }

      // Record the status update
      await db.insert(twilioStatusUpdates).values({
        messageSid: MessageSid,
        messageStatus: MessageStatus,
        errorCode: ErrorCode ? parseInt(ErrorCode, 10) : null,
        errorMessage: ErrorMessage || null,
        rawPayload: JSON.stringify(req.body),
      });

      // Update the sending record's status
      await db
        .update(twilioSendings)
        .set({
          status: MessageStatus,
          errorCode: ErrorCode ? parseInt(ErrorCode, 10) : null,
          errorMessage: ErrorMessage || null,
          updatedAt: new Date(),
        })
        .where(eq(twilioSendings.messageSid, MessageSid));

      // Twilio expects a TwiML response
      return res.status(200).type("text/xml").send("<Response></Response>");
    } catch (err) {
      console.error("Webhook processing error:", err);
      // Still return 200 to prevent Twilio from retrying
      return res.status(200).type("text/xml").send("<Response></Response>");
    }
  }
);

export default router;
