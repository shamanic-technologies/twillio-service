import { describe, it, expect } from "vitest";
import {
  normalizeWhatsAppPhone,
  getWhatsAppFromNumber,
} from "../../src/lib/twilio-client";
import { SendWhatsAppRequestSchema } from "../../src/schemas";

describe("normalizeWhatsAppPhone", () => {
  it("strips the whatsapp: prefix", () => {
    expect(normalizeWhatsAppPhone("whatsapp:+14155551234")).toBe(
      "+14155551234"
    );
  });

  it("is a no-op for a bare E.164 number", () => {
    expect(normalizeWhatsAppPhone("+14155551234")).toBe("+14155551234");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeWhatsAppPhone(" whatsapp:+14155551234 ")).toBe(
      "+14155551234"
    );
  });
});

describe("getWhatsAppFromNumber", () => {
  it("returns the code-owned sandbox number without the whatsapp: prefix", () => {
    expect(getWhatsAppFromNumber()).toBe("+14155238886");
  });
});

describe("SendWhatsAppRequestSchema", () => {
  it("accepts a minimal valid body", () => {
    const parsed = SendWhatsAppRequestSchema.safeParse({
      to: "+14155551234",
      body: "hello",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a body without a recipient", () => {
    const parsed = SendWhatsAppRequestSchema.safeParse({ body: "hello" });
    expect(parsed.success).toBe(false);
  });
});
