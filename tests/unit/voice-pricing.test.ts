import { describe, it, expect } from "vitest";
import {
  resolveVoiceCostName,
  billedMinutes,
  isE164,
  normalizePhone,
  VOICE_COST_NAME_US,
  VOICE_COST_NAME_FR_LANDLINE,
  VOICE_COST_NAME_FR_MOBILE,
  VOICE_COST_NAMES,
} from "../../src/lib/voice-pricing";

describe("cost names", () => {
  it("are byte-equal to the costs-service catalogue rows", () => {
    expect(VOICE_COST_NAME_US).toBe("twilio-voice-outbound-minute-us");
    expect(VOICE_COST_NAME_FR_LANDLINE).toBe(
      "twilio-voice-outbound-minute-fr-landline"
    );
    expect(VOICE_COST_NAME_FR_MOBILE).toBe(
      "twilio-voice-outbound-minute-fr-mobile"
    );
  });

  it("has one distinct name per band", () => {
    expect(new Set(VOICE_COST_NAMES).size).toBe(VOICE_COST_NAMES.length);
  });
});

describe("resolveVoiceCostName", () => {
  it("prices a US number under the US band", () => {
    expect(resolveVoiceCostName("+13159291895")).toBe(VOICE_COST_NAME_US);
  });

  it("prices a French mobile (06/07) under the French mobile band", () => {
    expect(resolveVoiceCostName("+33612345678")).toBe(
      VOICE_COST_NAME_FR_MOBILE
    );
    expect(resolveVoiceCostName("+33712345678")).toBe(
      VOICE_COST_NAME_FR_MOBILE
    );
  });

  it("prices any other French number under the French landline band", () => {
    expect(resolveVoiceCostName("+33123456789")).toBe(
      VOICE_COST_NAME_FR_LANDLINE
    );
  });

  it("tolerates spacing and punctuation", () => {
    expect(resolveVoiceCostName(" +33 6 12 34 56 78 ")).toBe(
      VOICE_COST_NAME_FR_MOBILE
    );
  });

  it("returns null for a destination with no published band", () => {
    expect(resolveVoiceCostName("+442071838750")).toBeNull();
    expect(resolveVoiceCostName("+4915112345678")).toBeNull();
  });

  it("returns null for a number that is not E.164", () => {
    expect(resolveVoiceCostName("0612345678")).toBeNull();
    expect(resolveVoiceCostName("not-a-number")).toBeNull();
  });
});

describe("isE164 / normalizePhone", () => {
  it("normalizes then validates", () => {
    expect(normalizePhone("+1 (315) 929-1895")).toBe("+13159291895");
    expect(isE164("+1 (315) 929-1895")).toBe(true);
    expect(isE164("3159291895")).toBe(false);
  });
});

describe("billedMinutes", () => {
  it("bills a started minute in full", () => {
    expect(billedMinutes(1)).toBe(1);
    expect(billedMinutes(59)).toBe(1);
    expect(billedMinutes(60)).toBe(1);
    expect(billedMinutes(61)).toBe(2);
    expect(billedMinutes(185)).toBe(4);
  });

  it("bills nothing for a leg that never connected", () => {
    expect(billedMinutes(0)).toBe(0);
    expect(billedMinutes(null)).toBe(0);
    expect(billedMinutes(NaN)).toBe(0);
  });
});
