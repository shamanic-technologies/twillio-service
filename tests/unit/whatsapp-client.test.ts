import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  const prev = process.env.TWILIO_WHATSAPP_NUMBER;
  afterEach(() => {
    if (prev === undefined) delete process.env.TWILIO_WHATSAPP_NUMBER;
    else process.env.TWILIO_WHATSAPP_NUMBER = prev;
  });

  it("returns the configured number without the whatsapp: prefix", () => {
    process.env.TWILIO_WHATSAPP_NUMBER = "whatsapp:+14155238886";
    expect(getWhatsAppFromNumber()).toBe("+14155238886");
  });

  it("throws when not configured", () => {
    delete process.env.TWILIO_WHATSAPP_NUMBER;
    expect(() => getWhatsAppFromNumber()).toThrow(
      /TWILIO_WHATSAPP_NUMBER not configured/
    );
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
