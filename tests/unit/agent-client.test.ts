import { describe, it, expect } from "vitest";
import {
  parseSseEvents,
  reduceAgentEvents,
} from "../../src/lib/agent-client";

describe("agent-client SSE parsing", () => {
  it("parses data frames into decoded payloads", () => {
    const raw =
      `data: {"sessionId":"sess-1"}\n\n` +
      `data: {"type":"token","content":"Hello"}\n\n` +
      `data: {"type":"token","content":" world"}\n\n` +
      `data: "[DONE]"\n\n`;
    const events = parseSseEvents(raw);
    expect(events).toEqual([
      { sessionId: "sess-1" },
      { type: "token", content: "Hello" },
      { type: "token", content: " world" },
      "[DONE]",
    ]);
  });

  it("ignores non-data lines and blank blocks", () => {
    const raw = `event: message\ndata: {"sessionId":"x"}\n\n\n\n`;
    expect(parseSseEvents(raw)).toEqual([{ sessionId: "x" }]);
  });
});

describe("agent-client event reduction", () => {
  it("accumulates token content and captures the session id", () => {
    const result = reduceAgentEvents([
      { sessionId: "sess-9" },
      { type: "token", content: "Foxy " },
      { type: "tool_call", name: "list_campaigns" },
      { type: "token", content: "here." },
      { type: "buttons", buttons: [{ label: "New campaign" }] },
      "[DONE]",
    ]);
    expect(result.sessionId).toBe("sess-9");
    expect(result.reply).toBe("Foxy here.");
  });

  it("stops accumulating at [DONE]", () => {
    const result = reduceAgentEvents([
      { type: "token", content: "kept" },
      "[DONE]",
      { type: "token", content: "dropped" },
    ]);
    expect(result.reply).toBe("kept");
  });

  it("throws on an error frame", () => {
    expect(() =>
      reduceAgentEvents([{ type: "error", message: "boom" }])
    ).toThrow(/boom/);
  });

  it("handles a stream with no session id", () => {
    const result = reduceAgentEvents([
      { type: "token", content: "hi" },
      "[DONE]",
    ]);
    expect(result.sessionId).toBeNull();
    expect(result.reply).toBe("hi");
  });
});
