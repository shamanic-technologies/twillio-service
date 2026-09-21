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

// ─── Identity and the walk back through the thread ──────────────────────────

import {
  buildIdentityLine,
  buildShortIdentityLine,
  buildMenuPrompt,
  buildHearOption,
  buildPriorMessageLine,
  PriorMessage,
} from "../../src/lib/voice-script";

const prior: PriorMessage[] = [
  { direction: "outbound", text: "Hi Dana, we help teams ship faster. Worth a chat?" },
  { direction: "outbound", text: "Just bumping this to the top of your inbox." },
];

const full: CallScriptInput = {
  ...input,
  reply: {
    ...input.reply,
    firstName: "Dana",
    lastName: "Reyes",
    title: "Head of Sales",
    city: "Austin",
    state: "Texas",
    country: "United States",
  },
};

describe("buildIdentityLine", () => {
  it("states every field it was given", () => {
    expect(buildIdentityLine(full)).toBe(
      "That is Dana Reyes, Head of Sales at Northwind, in Austin, Texas, United States."
    );
  });

  it("degrades cleanly when only some fields arrived", () => {
    const line = buildIdentityLine({
      ...input,
      reply: { name: "Dana Reyes", message: "yes", title: "Head of Sales" },
    });
    expect(line).toBe("That is Dana Reyes, Head of Sales.");
    expect(line).not.toContain("undefined");
  });

  it("never says undefined or an empty fragment for a blank field", () => {
    const line = buildIdentityLine({
      ...input,
      reply: { ...input.reply, city: "Austin", state: "   ", country: "" },
    });
    expect(line).toBe("That is Dana Reyes, at Northwind, in Austin.");
  });

  it("is null when nothing arrived beyond what the reply detail already said", () => {
    expect(buildIdentityLine(input)).toBeNull();
  });

  it("uses the spelled-out name over the display name", () => {
    expect(
      buildIdentityLine({
        ...input,
        reply: { name: "dana", message: "yes", firstName: "Dana", lastName: "Reyes" },
      })
    ).toBe("That is Dana Reyes.");
  });
});

describe("buildShortIdentityLine", () => {
  it("is just the name, from the first step back onward", () => {
    const short = buildShortIdentityLine(full);
    expect(short).toBe("Still about Dana Reyes.");
    expect(short).not.toContain("Head of Sales");
    expect(short).not.toContain("Austin");
  });
});

describe("buildMenuPrompt", () => {
  it("offers connect and the email they replied to at the start of the walk", () => {
    expect(buildMenuPrompt(input, prior, 0)).toBe(
      "Press 1 now to be connected to Dana Reyes. Press 2 to hear the email they replied to."
    );
  });

  it("calls a further step back the message before that", () => {
    expect(buildMenuPrompt(input, prior, 1)).toContain(
      "Press 2 to hear the message before that."
    );
  });

  it("omits the 2 option entirely when there is no earlier message", () => {
    const prompt = buildMenuPrompt(input, [], 0);
    expect(prompt).toBe("Press 1 now to be connected to Dana Reyes.");
    expect(prompt).not.toContain("Press 2");
  });

  it("says the thread is exhausted once the walk runs out", () => {
    const prompt = buildMenuPrompt(input, prior, 2);
    expect(prompt).toContain("Press 1 now to be connected");
    expect(prompt).not.toContain("Press 2");
    expect(prompt).toContain("nothing earlier in this thread");
  });

  it("still offers the 2 option when there is no number to connect to", () => {
    const prompt = buildMenuPrompt({ ...input, hasConnect: false }, prior, 0);
    expect(prompt).toBe("Press 2 to hear the email they replied to.");
  });

  it("produces the same words as before when neither new field was sent", () => {
    expect(buildMenuPrompt(input, [], 0)).toBe(buildConnectPrompt(input));
    expect(buildIdentityLine(input)).toBeNull();
  });
});

describe("buildPriorMessageLine", () => {
  it("introduces the first step back as the email they replied to", () => {
    expect(buildPriorMessageLine(prior, 0)).toBe(
      "The email they replied to said: Hi Dana, we help teams ship faster. Worth a chat?"
    );
  });

  it("says who wrote each further step back", () => {
    expect(buildPriorMessageLine(prior, 1)).toContain("Before that, we wrote:");
    expect(
      buildPriorMessageLine([{ direction: "inbound", text: "who is this" }], 1)
    ).toBeNull();
    expect(
      buildPriorMessageLine(
        [prior[0], { direction: "inbound", text: "who is this" }],
        1
      )
    ).toBe("Before that, they wrote: who is this");
  });

  it("caps a long email exactly as the reply is capped", () => {
    const long = "y".repeat(MAX_SPOKEN_MESSAGE_CHARS + 200);
    const spoken = buildPriorMessageLine([{ direction: "outbound", text: long }], 0);
    expect(spoken).toContain(forSpeech(long));
    expect(spoken!.endsWith("and it goes on.")).toBe(true);
  });

  it("returns null rather than throwing on an out-of-range or malformed index", () => {
    expect(buildPriorMessageLine(prior, 9)).toBeNull();
    expect(buildPriorMessageLine(prior, -1)).toBeNull();
    expect(buildPriorMessageLine(prior, Number.NaN)).toBeNull();
    expect(buildHearOption(prior, Number.MAX_SAFE_INTEGER)).toBeNull();
  });
});

describe("PlaceCallRequestSchema with the thread", () => {
  it("accepts the identity fields and a newest-first thread", () => {
    const parsed = PlaceCallRequestSchema.safeParse({
      to: "+13159291895",
      reply: {
        name: "Dana",
        message: "interested",
        firstName: "Dana",
        lastName: "Reyes",
        title: "Head of Sales",
        city: "Austin",
        state: "Texas",
        country: "United States",
      },
      priorMessages: [{ direction: "outbound", text: "hi" }],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a thread entry with an unknown direction", () => {
    expect(
      PlaceCallRequestSchema.safeParse({
        to: "+13159291895",
        reply: { name: "Dana", message: "interested" },
        priorMessages: [{ direction: "sideways", text: "hi" }],
      }).success
    ).toBe(false);
  });
});
