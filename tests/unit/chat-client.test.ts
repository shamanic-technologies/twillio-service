import { describe, it, expect } from "vitest";
import { parseSseEvents, reduceChatEvents } from "../../src/lib/chat-client";

describe("chat-client SSE parsing", () => {
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

describe("chat-client event reduction", () => {
  it("accumulates token content and captures the session id", () => {
    const result = reduceChatEvents([
      { sessionId: "sess-9" },
      { type: "thinking_start" },
      { type: "thinking_delta", delta: "hmm" },
      { type: "thinking_stop" },
      { type: "token", content: "Foxy " },
      { type: "tool_call", name: "list_campaigns" },
      { type: "tool_result", result: {} },
      { type: "token", content: "here." },
      { type: "buttons", buttons: [{ label: "New campaign", value: "new" }] },
      "[DONE]",
    ]);
    expect(result.sessionId).toBe("sess-9");
    expect(result.reply).toBe("Foxy here.");
  });

  it("stops accumulating at [DONE]", () => {
    const result = reduceChatEvents([
      { type: "token", content: "kept" },
      "[DONE]",
      { type: "token", content: "dropped" },
    ]);
    expect(result.reply).toBe("kept");
  });

  it("throws on an error frame", () => {
    expect(() =>
      reduceChatEvents([{ type: "error", message: "boom" }])
    ).toThrow(/boom/);
  });

  it("handles a stream with no session id", () => {
    const result = reduceChatEvents([
      { type: "token", content: "hi" },
      "[DONE]",
    ]);
    expect(result.sessionId).toBeNull();
    expect(result.reply).toBe("hi");
  });
});
