import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
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
    findFirstCall: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    placeCall: vi.fn(),
    createRun: vi.fn(),
    updateRun: vi.fn(),
    addCosts: vi.fn(),
  };
});

vi.mock("../../src/db", () => ({
  db: {
    query: { twilioCalls: { findFirst: h.findFirstCall } },
    insert: h.insert,
    update: h.update,
  },
}));

vi.mock("../../src/lib/runs-client", () => ({
  createRun: h.createRun,
  updateRun: h.updateRun,
  addCosts: h.addCosts,
}));

vi.mock("../../src/lib/twilio-client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../src/lib/twilio-client")
  >();
  return {
    ...actual,
    placeCall: h.placeCall,
    getVoiceFromNumber: () => "+13159291895",
    // Real validation resolves the Twilio auth token from key-service, which is
    // unreachable in tests.
    validateWebhookSignature: async () => true,
  };
});

import { createTestApp } from "../helpers/test-app";

const app = createTestApp();

const AUTH = {
  "X-API-Key": process.env.TWILIO_SERVICE_API_KEY || "test-secret-key",
  "x-org-id": "org-1",
  "x-user-id": "user-1",
};

const CALL_ROW = {
  id: "call-rec-1",
  callSid: "CA1",
  orgId: "org-1",
  userId: "user-1",
  runId: "run-1",
  from: "+13159291895",
  to: "+13155550100",
  connectTo: "+33612345678",
  connectName: null,
  brandName: "Acme",
  replyName: "Dana Reyes",
  replyCompany: "Northwind",
  replyMessage: "Sounds great, call me",
  summary: "Hello. This is Distribute for Acme. Press 1 to take this call.",
  detail: "Dana Reyes from Northwind replied to your campaign. They wrote: yes",
  costName: "twilio-voice-outbound-minute-us",
  connectCostName: "twilio-voice-outbound-minute-fr-mobile",
  status: "in-progress",
  accepted: false,
  connected: false,
  costDeclared: false,
  connectCostDeclared: false,
};

const BODY = {
  to: "+13155550100",
  reply: { name: "Dana Reyes", company: "Northwind", message: "Sounds great" },
  brandName: "Acme",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.insert.mockImplementation(() => h.chain([CALL_ROW]));
  h.update.mockImplementation(() => h.chain([]));
  h.createRun.mockResolvedValue({ id: "run-1" });
  h.updateRun.mockResolvedValue({});
  h.addCosts.mockResolvedValue({ costs: [] });
  h.placeCall.mockResolvedValue({
    success: true,
    callSid: "CA1",
    status: "queued",
  });
  h.findFirstCall.mockResolvedValue(CALL_ROW);
});

describe("POST /calls", () => {
  it("tracks a run, places the call, and reports the cost band", async () => {
    const res = await request(app).post("/calls").set(AUTH).send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.costName).toBe("twilio-voice-outbound-minute-us");
    expect(res.body.callSid).toBe("CA1");
    expect(res.body.connectOffered).toBe(false);
    expect(h.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        serviceName: "twilio-service",
        taskName: "place-call",
      })
    );
    // The answer webhook, not a full announcement, is what Twilio fetches.
    expect(h.placeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "+13159291895",
        to: "+13155550100",
        url: expect.stringContaining("/webhooks/twilio/voice/answer?ref="),
        statusCallback: expect.stringContaining(
          "/webhooks/twilio/voice/status?ref="
        ),
      })
    );
  });

  it("reports the connect option when a number to connect to was supplied", async () => {
    const res = await request(app)
      .post("/calls")
      .set(AUTH)
      .send({ ...BODY, connectTo: "+33612345678" });

    expect(res.status).toBe(200);
    expect(res.body.connectOffered).toBe(true);
  });

  it("refuses a destination with no published cost band, before dialling", async () => {
    const res = await request(app)
      .post("/calls")
      .set(AUTH)
      .send({ ...BODY, to: "+442071838750" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unsupported destination");
    expect(h.placeCall).not.toHaveBeenCalled();
    expect(h.createRun).not.toHaveBeenCalled();
  });

  it("refuses a connect destination with no published cost band", async () => {
    const res = await request(app)
      .post("/calls")
      .set(AUTH)
      .send({ ...BODY, connectTo: "+442071838750" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unsupported connect destination");
    expect(h.placeCall).not.toHaveBeenCalled();
  });

  it("surfaces a Twilio rejection as a failure, never as a placed call", async () => {
    h.placeCall.mockResolvedValue({
      success: false,
      errorCode: 21215,
      errorMessage: "Account not authorized to call +33...",
    });

    const res = await request(app).post("/calls").set(AUTH).send(BODY);

    expect(res.status).toBe(502);
    expect(res.body.success).toBeUndefined();
    expect(res.body.message).toContain("not authorized");
    expect(h.updateRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      expect.anything(),
      expect.stringContaining("not authorized")
    );
  });

  it("rejects a body with no reply", async () => {
    const res = await request(app)
      .post("/calls")
      .set(AUTH)
      .send({ to: "+13155550100" });
    expect(res.status).toBe(400);
  });

  it("requires service auth", async () => {
    const res = await request(app).post("/calls").send(BODY);
    expect(res.status).toBe(401);
  });
});

describe("GET /calls/:id", () => {
  it("returns the call, whose accepted flag tells a taken call from an untaken one", async () => {
    const res = await request(app).get("/calls/CA1").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.call.accepted).toBe(false);
    expect(res.body.call.status).toBe("in-progress");
  });

  it("404s an unknown call", async () => {
    h.findFirstCall.mockResolvedValue(undefined);
    const res = await request(app).get("/calls/CA-nope").set(AUTH);
    expect(res.status).toBe(404);
  });
});

describe("the answer leg", () => {
  it("asks for the accept keypress and says nothing else", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/answer?ref=call-rec-1")
      .type("form")
      .send({ CallSid: "CA1", CallStatus: "in-progress" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("<Gather");
    expect(res.text).toContain("Press 1 to take this call");
    expect(res.text).toContain("/webhooks/twilio/voice/accept?ref=call-rec-1");
    // The detail is NOT spoken before the keypress, so a voicemail cannot hear it.
    expect(res.text).not.toContain("Northwind");
    // No keypress ends the call rather than continuing.
    expect(res.text).toContain("No key was pressed");
    expect(res.text).toContain("<Hangup/>");
  });

  it("needs no X-API-Key (Twilio-signed)", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/answer?ref=call-rec-1")
      .type("form")
      .send({});
    expect(res.status).toBe(200);
  });
});

describe("the accept leg", () => {
  it("plays the detail and offers the connect keypress on a 1", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/accept?ref=call-rec-1")
      .type("form")
      .send({ Digits: "1" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Dana Reyes");
    expect(res.text).toContain("Northwind");
    expect(res.text).toContain("<Gather");
    expect(res.text).toContain("/webhooks/twilio/voice/connect?ref=call-rec-1");
  });

  it("leaves the call untaken and says nothing more on any other key", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/accept?ref=call-rec-1")
      .type("form")
      .send({ Digits: "3" });

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("Northwind");
    expect(res.text).toContain("<Hangup/>");
  });

  it("states the connect option is unavailable when no number was supplied", async () => {
    h.findFirstCall.mockResolvedValue({
      ...CALL_ROW,
      connectTo: null,
      connectCostName: null,
    });

    const res = await request(app)
      .post("/webhooks/twilio/voice/accept?ref=call-rec-1")
      .type("form")
      .send({ Digits: "1" });

    expect(res.text).toContain("do not have a phone number");
    expect(res.text).not.toContain("<Gather");
    expect(res.text).not.toContain("/webhooks/twilio/voice/connect");
  });
});

describe("the connect leg", () => {
  it("bridges only on the second deliberate keypress", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/connect?ref=call-rec-1")
      .type("form")
      .send({ Digits: "1" });

    expect(res.text).toContain("<Dial");
    expect(res.text).toContain("+33612345678");
    expect(res.text).toContain("/webhooks/twilio/voice/dial-status?ref=");
  });

  it("does not dial on any other key", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/connect?ref=call-rec-1")
      .type("form")
      .send({ Digits: "9" });

    expect(res.text).not.toContain("<Dial");
    expect(res.text).toContain("<Hangup/>");
  });

  it("does not dial when no connect number exists", async () => {
    h.findFirstCall.mockResolvedValue({ ...CALL_ROW, connectTo: null });
    const res = await request(app)
      .post("/webhooks/twilio/voice/connect?ref=call-rec-1")
      .type("form")
      .send({ Digits: "1" });
    expect(res.text).not.toContain("<Dial");
  });
});

describe("cost declaration", () => {
  it("declares the placed leg's minutes under the catalogue band and closes the run", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/voice/status?ref=call-rec-1")
      .type("form")
      .send({ CallSid: "CA1", CallStatus: "completed", CallDuration: "95" });

    expect(res.status).toBe(200);
    expect(h.addCosts).toHaveBeenCalledWith(
      "run-1",
      [
        {
          costName: "twilio-voice-outbound-minute-us",
          costSource: "platform",
          quantity: 2,
        },
      ],
      { orgId: "org-1", userId: "user-1" }
    );
    expect(h.updateRun).toHaveBeenCalledWith(
      "run-1",
      "completed",
      { orgId: "org-1", userId: "user-1" },
      undefined
    );
  });

  it("declares the bridged leg under the band of the number bridged to", async () => {
    await request(app)
      .post("/webhooks/twilio/voice/dial-status?ref=call-rec-1")
      .type("form")
      .send({ DialCallStatus: "completed", DialCallDuration: "30" });

    expect(h.addCosts).toHaveBeenCalledWith(
      "run-1",
      [
        {
          costName: "twilio-voice-outbound-minute-fr-mobile",
          costSource: "platform",
          quantity: 1,
        },
      ],
      { orgId: "org-1", userId: "user-1" }
    );
  });

  it("does not declare twice when Twilio retries the callback", async () => {
    h.findFirstCall.mockResolvedValue({ ...CALL_ROW, costDeclared: true });

    await request(app)
      .post("/webhooks/twilio/voice/status?ref=call-rec-1")
      .type("form")
      .send({ CallStatus: "completed", CallDuration: "95" });

    expect(h.addCosts).not.toHaveBeenCalled();
  });

  it("declares nothing for a call nobody answered, and still records the outcome", async () => {
    await request(app)
      .post("/webhooks/twilio/voice/status?ref=call-rec-1")
      .type("form")
      .send({ CallStatus: "no-answer", CallDuration: "0" });

    expect(h.addCosts).not.toHaveBeenCalled();
    expect(h.updateRun).toHaveBeenCalledWith(
      "run-1",
      "completed",
      expect.anything(),
      undefined
    );
  });

  it("fails the run when Twilio reports the call as failed", async () => {
    await request(app)
      .post("/webhooks/twilio/voice/status?ref=call-rec-1")
      .type("form")
      .send({ CallStatus: "failed", CallDuration: "0" });

    expect(h.updateRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      expect.anything(),
      expect.stringContaining("failed")
    );
  });
});
