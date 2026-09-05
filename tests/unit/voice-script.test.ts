import { describe, it, expect } from "vitest";
import {
  buildSummary,
  buildDetail,
  buildConnectPrompt,
  buildNoConnectLine,
  forSpeech,
  MAX_SPOKEN_MESSAGE_CHARS,
  CallScriptInput,
} from "../../src/lib/voice-script";
import { PlaceCallRequestSchema } from "../../src/schemas";

const input: CallScriptInput = {
  reply: { name: "Dana Reyes", company: "Northwind", message: "Sounds great, call me" },
  brandName: "Acme",
  hasConnect: true,
};

describe("buildSummary", () => {
  it("asks for the accept keypress", () => {
    expect(buildSummary(input)).toContain("Press 1 to take this call");
  });

  it("names the brand when given one, and omits it otherwise", () => {
    expect(buildSummary(input)).toContain("for Acme");
    expect(buildSummary({ ...input, brandName: undefined })).not.toContain(
      "for Acme"
    );
  });

  it("does not leak who replied or what they wrote before the keypress", () => {
    const summary = buildSummary(input);
    expect(summary).not.toContain("Dana Reyes");
    expect(summary).not.toContain("Northwind");
    expect(summary).not.toContain("Sounds great");
  });
});

describe("buildDetail", () => {
  it("says who replied, which company, and what they wrote", () => {
    const detail = buildDetail(input);
    expect(detail).toContain("Dana Reyes");
    expect(detail).toContain("Northwind");
    expect(detail).toContain("Sounds great, call me");
  });

  it("drops the company clause when it is unknown", () => {
    const detail = buildDetail({
      ...input,
      reply: { name: "Dana Reyes", message: "yes" },
    });
    expect(detail).toContain("Dana Reyes replied");
    expect(detail).not.toContain("from");
  });
});

describe("connect lines", () => {
  it("asks for a second keypress when there is a number to connect to", () => {
    expect(buildConnectPrompt(input)).toBe(
      "Press 1 now to be connected to Dana Reyes."
    );
  });

  it("uses the connect name when the bridge target is not the replier", () => {
    expect(buildConnectPrompt({ ...input, connectName: "the prospect" })).toBe(
      "Press 1 now to be connected to the prospect."
    );
  });

  it("states the connect option is unavailable rather than omitting it", () => {
    const line = buildNoConnectLine({ ...input, hasConnect: false });
    expect(line).toContain("do not have a phone number");
    expect(line).toContain("Dana Reyes");
  });
});

describe("forSpeech", () => {
  it("flattens whitespace", () => {
    expect(forSpeech("a\n\n  b")).toBe("a b");
  });

  it("trims a reply too long to dictate", () => {
    const long = "x".repeat(MAX_SPOKEN_MESSAGE_CHARS + 200);
    const spoken = forSpeech(long);
    expect(spoken.length).toBeLessThan(long.length);
    expect(spoken.endsWith("and it goes on.")).toBe(true);
  });
});

describe("PlaceCallRequestSchema", () => {
  it("accepts a minimal call request", () => {
    const parsed = PlaceCallRequestSchema.safeParse({
      to: "+13159291895",
      reply: { name: "Dana", message: "interested" },
    });
    expect(parsed.success).toBe(true);
  });

  it("requires a reply name and message", () => {
    expect(
      PlaceCallRequestSchema.safeParse({
        to: "+13159291895",
        reply: { name: "", message: "" },
      }).success
    ).toBe(false);
    expect(
      PlaceCallRequestSchema.safeParse({ to: "+13159291895" }).success
    ).toBe(false);
  });

  it("treats connectTo as optional", () => {
    const parsed = PlaceCallRequestSchema.safeParse({
      to: "+13159291895",
      reply: { name: "Dana", message: "interested" },
      connectTo: "+33612345678",
    });
    expect(parsed.success).toBe(true);
  });
});
