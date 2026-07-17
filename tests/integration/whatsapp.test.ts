import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// ─── Hoisted mock functions (shared with the vi.mock factories) ──────────────

const h = vi.hoisted(() => {
  // A drizzle-like chainable that is both awaitable and exposes the builder
  // methods handleInboundWhatsApp / the route use.
  const chain = (result: unknown): any => {
    const p: any = Promise.resolve(result);
    p.onConflictDoUpdate = () => Promise.resolve(result);
    p.returning = () => Promise.resolve(result);
    p.where = () => Promise.resolve(result);
    p.set = () => chain(result);
    p.values = () => chain(result);
    return p;
  };
  return {
    chain,
    findFirstUser: vi.fn(),
    findFirstSession: vi.fn(),
    insert: vi.fn(() => chain([{ id: "rec-1" }])),
    update: vi.fn(() => chain([])),
    resolveOrProvision: vi.fn(),
    runChat: vi.fn(),
    sendWhatsApp: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    addCosts: vi.fn(),
  };
});

vi.mock("../../src/db", () => ({
  db: {
    query: {
      whatsappUsers: { findFirst: h.findFirstUser },
      whatsappSessions: { findFirst: h.findFirstSession },
    },
    insert: h.insert,
    update: h.update,
  },
}));

vi.mock("../../src/lib/client-client", () => ({
  resolveOrProvisionAccountByPhone: h.resolveOrProvision,
}));

vi.mock("../../src/lib/chat-client", () => ({
  runChat: h.runChat,
}));

vi.mock("../../src/lib/runs-client", () => ({
  createRun: h.createRun,
  updateRun: h.updateRun,
  addCosts: h.addCosts,
}));

vi.mock("../../src/lib/twilio-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/twilio-client")>();
  return {
    ...actual,
    sendWhatsApp: h.sendWhatsApp,
    getWhatsAppFromNumber: () => "+14155238886",
  };
});

import { handleInboundWhatsApp } from "../../src/routes/whatsapp";
import { createTestApp } from "../helpers/test-app";

const app = createTestApp();

function primeHappyPath() {
  h.createRun.mockResolvedValue({ id: "run-1" });
  h.findFirstSession.mockResolvedValue(undefined);
  h.runChat.mockResolvedValue({
    sessionId: "sess-1",
    reply: "Hi, I'm Foxy 👋",
  });
  h.sendWhatsApp.mockResolvedValue({
    success: true,
    messageSid: "WA1",
    status: "queued",
  });
  h.updateRun.mockResolvedValue({});
}

describe("handleInboundWhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.insert.mockImplementation(() => h.chain([{ id: "rec-1" }]));
    h.update.mockImplementation(() => h.chain([]));
  });

  it("provisions an account for an UNKNOWN number, then forwards + replies", async () => {
    h.findFirstUser.mockResolvedValue(undefined);
    h.resolveOrProvision.mockResolvedValue({
      orgId: "org-new",
      userId: "user-new",
      created: true,
    });
    primeHappyPath();

    await handleInboundWhatsApp({
      from: "whatsapp:+14155551234",
      body: "hello",
      messageSid: "SM1",
      profileName: "Kevin",
    });

    // Provisioned via client-service with the normalized phone.
    expect(h.resolveOrProvision).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "+14155551234", source: "whatsapp" })
    );
    // A run is tracked for the message.
    expect(h.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-new",
        userId: "user-new",
        serviceName: "twilio-service",
        taskName: "whatsapp-inbound",
      })
    );
    // Forwarded to the chat-service agent, scoped to the resolved account.
    expect(h.runChat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "hello",
        orgId: "org-new",
        userId: "user-new",
        runId: "run-1",
      })
    );
    // Reply delivered back over WhatsApp to the sender.
    expect(h.sendWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+14155551234", body: "Hi, I'm Foxy 👋" })
    );
    // Run completed.
    expect(h.updateRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("resolves a KNOWN number instantly without provisioning", async () => {
    h.findFirstUser.mockResolvedValue({
      phone: "+14155551234",
      isActive: true,
      orgId: "org-known",
      userId: "user-known",
    });
    primeHappyPath();

    await handleInboundWhatsApp({
      from: "whatsapp:+14155551234",
      body: "again",
      messageSid: "SM2",
    });

    expect(h.resolveOrProvision).not.toHaveBeenCalled();
    expect(h.runChat).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-known", userId: "user-known" })
    );
    expect(h.sendWhatsApp).toHaveBeenCalled();
    expect(h.updateRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("marks the run failed and rethrows when the agent errors", async () => {
    h.findFirstUser.mockResolvedValue({
      phone: "+14155551234",
      isActive: true,
      orgId: "org-x",
      userId: "user-x",
    });
    h.createRun.mockResolvedValue({ id: "run-err" });
    h.findFirstSession.mockResolvedValue(undefined);
    h.runChat.mockRejectedValue(new Error("agent down"));
    h.updateRun.mockResolvedValue({});

    await expect(
      handleInboundWhatsApp({
        from: "whatsapp:+14155551234",
        body: "boom",
        messageSid: "SM3",
      })
    ).rejects.toThrow(/agent down/);

    expect(h.updateRun).toHaveBeenCalledWith(
      "run-err",
      "failed",
      expect.any(String)
    );
  });
});

describe("POST /webhooks/twilio/whatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.insert.mockImplementation(() => h.chain([{ id: "rec-1" }]));
    h.update.mockImplementation(() => h.chain([]));
    h.findFirstUser.mockResolvedValue({
      phone: "+14155551234",
      isActive: true,
      orgId: "org-known",
      userId: "user-known",
    });
    primeHappyPath();
  });

  it("acks Twilio immediately with empty TwiML (no X-API-Key required)", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/whatsapp")
      .type("form")
      .send({
        From: "whatsapp:+14155551234",
        To: "whatsapp:+14155238886",
        Body: "hi",
        MessageSid: "SM100",
        WaId: "14155551234",
        ProfileName: "Kevin",
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("xml");
    expect(res.text).toContain("<Response></Response>");
  });

  it("acks even when the payload is missing text (no processing)", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/whatsapp")
      .type("form")
      .send({ From: "whatsapp:+14155551234" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("<Response></Response>");
  });
});

describe("POST /send/whatsapp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.insert.mockImplementation(() => h.chain([{ id: "rec-1" }]));
    h.createRun.mockResolvedValue({ id: "run-send" });
    h.sendWhatsApp.mockResolvedValue({
      success: true,
      messageSid: "WA-OUT",
      status: "queued",
    });
    h.updateRun.mockResolvedValue({});
  });

  it("requires service auth + identity headers", async () => {
    const res = await request(app)
      .post("/send/whatsapp")
      .send({ to: "+14155551234", body: "hi" });
    expect(res.status).toBe(401);
  });

  it("sends a WhatsApp message and tracks a run", async () => {
    const res = await request(app)
      .post("/send/whatsapp")
      .set("X-API-Key", "test-secret-key")
      .set("X-Org-Id", "org-1")
      .set("X-User-Id", "user-1")
      .send({ to: "+14155551234", body: "hello from service" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.messageSid).toBe("WA-OUT");
    expect(h.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ taskName: "whatsapp-send" })
    );
    expect(h.sendWhatsApp).toHaveBeenCalledWith(
      expect.objectContaining({ to: "+14155551234", body: "hello from service" })
    );
    expect(h.updateRun).toHaveBeenCalledWith("run-send", "completed");
  });

  it("returns 400 on a missing recipient", async () => {
    const res = await request(app)
      .post("/send/whatsapp")
      .set("X-API-Key", "test-secret-key")
      .set("X-Org-Id", "org-1")
      .set("X-User-Id", "user-1")
      .send({ body: "no recipient" });
    expect(res.status).toBe(400);
  });
});
