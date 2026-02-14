import { Router, Request, Response } from "express";
import { db } from "../db";
import { twilioSendings } from "../db/schema";
import {
  sendSms,
  getFromNumber,
} from "../lib/twilio-client";
import { createRun, updateRun, addCosts } from "../lib/runs-client";
import {
  SendSmsRequestSchema,
  BatchSendSmsRequestSchema,
} from "../schemas";

const router = Router();

// ─── POST /send ────────────────────────────────────────────────────────────

router.post("/send", async (req: Request, res: Response) => {
  try {
    const parsed = SendSmsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        message: parsed.error.issues.map((e) => e.message).join(", "),
      });
    }

    const data = parsed.data;
    let runId: string | undefined;

    // Create run in runs-service if orgId is provided (BLOCKING)
    if (data.orgId) {
      try {
        const run = await createRun({
          clerkOrgId: data.orgId,
          appId: data.appId || "twilio-service",
          serviceName: "twilio-service",
          taskName: "send-sms",
          parentRunId: data.runId,
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
    }

    // Determine "from" number
    const fromNumber = data.from || getFromNumber(data.project);

    // Send SMS via Twilio
    const result = await sendSms({
      from: fromNumber,
      to: data.to,
      body: data.body,
      statusCallback: data.statusCallback,
      project: data.project,
    });

    if (!result.success) {
      // Mark run as failed if we created one
      if (runId) {
        await updateRun(runId, "failed", result.errorMessage).catch(
          console.error
        );
      }
      return res.status(500).json({
        error: "Failed to send SMS",
        message: result.errorMessage,
      });
    }

    // Record sending in database
    const [record] = await db
      .insert(twilioSendings)
      .values({
        messageSid: result.messageSid!,
        orgId: data.orgId,
        runId: data.runId,
        brandId: data.brandId,
        appId: data.appId,
        campaignId: data.campaignId,
        from: fromNumber,
        to: data.to,
        body: data.body,
        status: result.status || "queued",
        numSegments: result.numSegments
          ? parseInt(result.numSegments, 10)
          : null,
      })
      .returning({ id: twilioSendings.id });

    // Add costs to run if successful
    if (runId) {
      try {
        const segments = result.numSegments
          ? parseInt(result.numSegments, 10)
          : 1;
        await addCosts(runId, [
          { costName: "twilio-sms-segment", quantity: segments },
        ]);
        await updateRun(runId, "completed");
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
    console.error("POST /send error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─── POST /send/batch ──────────────────────────────────────────────────────

router.post("/send/batch", async (req: Request, res: Response) => {
  try {
    const parsed = BatchSendSmsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        message: parsed.error.issues.map((e) => e.message).join(", "),
      });
    }

    const { messages } = parsed.data;
    const results = [];
    let totalSent = 0;
    let totalFailed = 0;

    for (const msg of messages) {
      let runId: string | undefined;

      if (msg.orgId) {
        try {
          const run = await createRun({
            clerkOrgId: msg.orgId,
            appId: msg.appId || "twilio-service",
            serviceName: "twilio-service",
            taskName: "send-sms",
            parentRunId: msg.runId,
            brandId: msg.brandId,
            campaignId: msg.campaignId,
          });
          runId = run.id;
        } catch (err) {
          console.error("Failed to create run for batch item:", err);
          results.push({ success: false });
          totalFailed++;
          continue;
        }
      }

      const fromNumber = msg.from || getFromNumber(msg.project);

      const result = await sendSms({
        from: fromNumber,
        to: msg.to,
        body: msg.body,
        statusCallback: msg.statusCallback,
        project: msg.project,
      });

      if (result.success) {
        const [record] = await db
          .insert(twilioSendings)
          .values({
            messageSid: result.messageSid!,
            orgId: msg.orgId,
            runId: msg.runId,
            brandId: msg.brandId,
            appId: msg.appId,
            campaignId: msg.campaignId,
            from: fromNumber,
            to: msg.to,
            body: msg.body,
            status: result.status || "queued",
            numSegments: result.numSegments
              ? parseInt(result.numSegments, 10)
              : null,
          })
          .returning({ id: twilioSendings.id });

        if (runId) {
          try {
            const segments = result.numSegments
              ? parseInt(result.numSegments, 10)
              : 1;
            await addCosts(runId, [
              { costName: "twilio-sms-segment", quantity: segments },
            ]);
            await updateRun(runId, "completed");
          } catch (err) {
            console.error("Failed to add costs/complete run:", err);
          }
        }

        results.push({
          success: true,
          messageSid: result.messageSid,
          status: result.status,
          numSegments: result.numSegments,
          recordId: record.id,
        });
        totalSent++;
      } else {
        if (runId) {
          await updateRun(runId, "failed", result.errorMessage).catch(
            console.error
          );
        }
        results.push({ success: false });
        totalFailed++;
      }
    }

    return res.status(200).json({ results, totalSent, totalFailed });
  } catch (err) {
    console.error("POST /send/batch error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
