import { Router, Request, Response } from "express";
import { eq, inArray, and, sql } from "drizzle-orm";
import { db } from "../db";
import { twilioSendings, twilioStatusUpdates } from "../db/schema";
import { StatsRequestSchema } from "../schemas";

const router = Router();

// ─── GET /status/:messageSid ───────────────────────────────────────────────

router.get("/status/:messageSid", async (req: Request, res: Response) => {
  try {
    const { messageSid } = req.params;

    const sending = await db.query.twilioSendings.findFirst({
      where: eq(twilioSendings.messageSid, messageSid),
    });

    if (!sending) {
      return res.status(404).json({ error: "Message not found" });
    }

    const statusUpdates = await db.query.twilioStatusUpdates.findMany({
      where: eq(twilioStatusUpdates.messageSid, messageSid),
      orderBy: (su, { asc }) => [asc(su.receivedAt)],
    });

    return res.status(200).json({
      sending,
      statusUpdates: statusUpdates.map((su) => ({
        id: su.id,
        messageStatus: su.messageStatus,
        errorCode: su.errorCode,
        errorMessage: su.errorMessage,
        receivedAt: su.receivedAt,
      })),
    });
  } catch (err) {
    console.error("GET /status/:messageSid error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─── GET /status/by-org/:orgId ─────────────────────────────────────────────

router.get("/status/by-org/:orgId", async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;

    const sendings = await db.query.twilioSendings.findMany({
      where: eq(twilioSendings.orgId, orgId),
      orderBy: (s, { desc }) => [desc(s.sentAt)],
      limit: 100,
    });

    return res.status(200).json({ sendings });
  } catch (err) {
    console.error("GET /status/by-org/:orgId error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─── GET /status/by-run/:runId ─────────────────────────────────────────────

router.get("/status/by-run/:runId", async (req: Request, res: Response) => {
  try {
    const { runId } = req.params;

    const sendings = await db.query.twilioSendings.findMany({
      where: eq(twilioSendings.runId, runId),
      orderBy: (s, { desc }) => [desc(s.sentAt)],
    });

    return res.status(200).json({ sendings });
  } catch (err) {
    console.error("GET /status/by-run/:runId error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

// ─── POST /stats ───────────────────────────────────────────────────────────

router.post("/stats", async (req: Request, res: Response) => {
  try {
    const parsed = StatsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request",
        message: parsed.error.issues.map((e) => e.message).join(", "),
      });
    }

    const filters = parsed.data;
    const conditions = [];

    if (filters.runIds && filters.runIds.length > 0) {
      conditions.push(inArray(twilioSendings.runId, filters.runIds));
    }
    if (filters.orgId) {
      conditions.push(eq(twilioSendings.orgId, filters.orgId));
    }
    if (filters.brandId) {
      conditions.push(eq(twilioSendings.brandId, filters.brandId));
    }
    if (filters.campaignId) {
      conditions.push(eq(twilioSendings.campaignId, filters.campaignId));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [stats] = await db
      .select({
        totalSent: sql<number>`count(*)::int`,
        totalDelivered: sql<number>`count(*) filter (where ${twilioSendings.status} = 'delivered')::int`,
        totalFailed: sql<number>`count(*) filter (where ${twilioSendings.status} = 'failed')::int`,
        totalUndelivered: sql<number>`count(*) filter (where ${twilioSendings.status} = 'undelivered')::int`,
      })
      .from(twilioSendings)
      .where(where);

    return res.status(200).json(stats);
  } catch (err) {
    console.error("POST /stats error:", err);
    return res.status(500).json({
      error: "Internal server error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
