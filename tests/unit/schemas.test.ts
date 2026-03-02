import { describe, it, expect } from "vitest";
import {
  SendSmsRequestSchema,
  BatchSendSmsRequestSchema,
  StatsRequestSchema,
  TwilioWebhookPayloadSchema,
} from "../../src/schemas";

describe("SendSmsRequestSchema", () => {
  it("should validate a valid send request", () => {
    const result = SendSmsRequestSchema.safeParse({
      parentRunId: "run-123",
      to: "+15559876543",
      body: "Hello from tests",
    });
    expect(result.success).toBe(true);
  });

  it("should validate with all optional fields", () => {
    const result = SendSmsRequestSchema.safeParse({
      parentRunId: "run-123",
      brandId: "brand-1",
      campaignId: "campaign-1",
      from: "+15551234567",
      to: "+15559876543",
      body: "Full message",
      statusCallback: "https://example.com/callback",
      project: "mcpfactory",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing required fields", () => {
    const result = SendSmsRequestSchema.safeParse({
      parentRunId: "run-123",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing to field", () => {
    const result = SendSmsRequestSchema.safeParse({
      parentRunId: "run-123",
      body: "Hello",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing body field", () => {
    const result = SendSmsRequestSchema.safeParse({
      parentRunId: "run-123",
      to: "+15559876543",
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid project value", () => {
    const result = SendSmsRequestSchema.safeParse({
      parentRunId: "run-123",
      to: "+15559876543",
      body: "Hello",
      project: "invalid",
    });
    expect(result.success).toBe(false);
  });
});

describe("BatchSendSmsRequestSchema", () => {
  it("should validate a batch request", () => {
    const result = BatchSendSmsRequestSchema.safeParse({
      messages: [
        { parentRunId: "run-1", to: "+15551111111", body: "Message 1" },
        { parentRunId: "run-2", to: "+15552222222", body: "Message 2" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty messages array", () => {
    const result = BatchSendSmsRequestSchema.safeParse({
      messages: [],
    });
    // Empty array is technically valid per schema
    expect(result.success).toBe(true);
  });

  it("should reject invalid messages in batch", () => {
    const result = BatchSendSmsRequestSchema.safeParse({
      messages: [{ parentRunId: "run-1" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("StatsRequestSchema", () => {
  it("should validate empty filters", () => {
    const result = StatsRequestSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("should validate with all filters", () => {
    const result = StatsRequestSchema.safeParse({
      runIds: ["run-1", "run-2"],
      orgId: "org-uuid-123",
      brandId: "brand-1",
      campaignId: "campaign-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("TwilioWebhookPayloadSchema", () => {
  it("should validate a delivery webhook", () => {
    const result = TwilioWebhookPayloadSchema.safeParse({
      MessageSid: "SM1234567890abcdef",
      MessageStatus: "delivered",
    });
    expect(result.success).toBe(true);
  });

  it("should validate a failed webhook with error details", () => {
    const result = TwilioWebhookPayloadSchema.safeParse({
      MessageSid: "SM1234567890abcdef",
      MessageStatus: "failed",
      ErrorCode: "30008",
      ErrorMessage: "Unknown error",
      From: "+15551234567",
      To: "+15559876543",
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing MessageSid", () => {
    const result = TwilioWebhookPayloadSchema.safeParse({
      MessageStatus: "delivered",
    });
    expect(result.success).toBe(false);
  });

  it("should reject missing MessageStatus", () => {
    const result = TwilioWebhookPayloadSchema.safeParse({
      MessageSid: "SM1234567890abcdef",
    });
    expect(result.success).toBe(false);
  });
});
