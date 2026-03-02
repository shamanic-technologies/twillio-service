import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app";

const app = createTestApp();

describe("Service authentication", () => {
  it("should allow unauthenticated access to /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("should allow unauthenticated access to /", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
  });

  it("should reject requests without API key to protected routes", async () => {
    const res = await request(app)
      .post("/send")
      .send({ to: "+15559876543", body: "test" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing API key");
  });

  it("should reject requests with invalid API key", async () => {
    const res = await request(app)
      .post("/send")
      .set("X-API-Key", "wrong-key")
      .send({ to: "+15559876543", body: "test" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Invalid API key");
  });

  it("should reject requests with valid API key but missing identity headers", async () => {
    const res = await request(app)
      .post("/send")
      .set("X-API-Key", "test-secret-key")
      .send({ to: "+15559876543", body: "test" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required header");
  });

  it("should reject requests missing x-org-id header", async () => {
    const res = await request(app)
      .post("/send")
      .set("X-API-Key", "test-secret-key")
      .set("X-User-Id", "user-uuid-123")
      .send({ parentRunId: "run-1", to: "+15559876543", body: "test" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("x-org-id");
  });

  it("should reject requests missing x-user-id header", async () => {
    const res = await request(app)
      .post("/send")
      .set("X-API-Key", "test-secret-key")
      .set("X-Org-Id", "org-uuid-123")
      .send({ parentRunId: "run-1", to: "+15559876543", body: "test" });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("x-user-id");
  });

  it("should pass auth with valid API key and identity headers", async () => {
    const res = await request(app)
      .post("/send")
      .set("X-API-Key", "test-secret-key")
      .set("X-Org-Id", "org-uuid-123")
      .set("X-User-Id", "user-uuid-123")
      .send({ parentRunId: "run-1", to: "+15559876543", body: "test" });
    // Should get past auth — 400 (validation) or 500 (no DB), not 401/403
    expect(res.body.error).not.toBe("Missing API key");
    expect(res.body.error).not.toBe("Invalid API key");
    expect(res.body.error).not.toBe("Missing required header");
  });

  it("should allow unauthenticated access to webhook endpoints", async () => {
    const res = await request(app)
      .post("/webhooks/twilio/status")
      .type("form")
      .send({
        MessageSid: "SM123",
        MessageStatus: "delivered",
      });
    // Should not get 401/403
    expect([200, 400, 500]).toContain(res.status);
  });
});
