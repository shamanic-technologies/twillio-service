import { describe, it, expect, afterEach, vi } from "vitest";
import { resolvePlatformKey } from "../../src/lib/key-client";

// key-client captures KEY_SERVICE_URL / KEY_SERVICE_API_KEY at module load (same
// pattern as chat-client / client-client), so the base URL is the setup.ts value.
const BASE = process.env.KEY_SERVICE_URL;

describe("resolvePlatformKey", () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it("resolves a platform key via GET /keys/platform/:provider/decrypt", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ provider: "twilio", key: "secret-blob" }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const key = await resolvePlatformKey("twilio");
    expect(key).toBe("secret-blob");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/keys/platform/twilio/decrypt`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(process.env.KEY_SERVICE_API_KEY);
    expect(headers["x-caller-service"]).toBe("twilio-service");
    expect(headers["x-caller-path"]).toBe("/keys/platform/twilio/decrypt");
  });

  it("fails loud when key-service is not configured", async () => {
    // Re-import the module with the env unset to hit the config guard.
    vi.resetModules();
    const prev = process.env.KEY_SERVICE_URL;
    delete process.env.KEY_SERVICE_URL;
    try {
      const { resolvePlatformKey: fresh } = await import(
        "../../src/lib/key-client"
      );
      await expect(fresh("twilio")).rejects.toThrow(
        /KEY_SERVICE_URL or KEY_SERVICE_API_KEY not configured/
      );
    } finally {
      process.env.KEY_SERVICE_URL = prev;
      vi.resetModules();
    }
  });

  it("fails loud on a non-2xx response (e.g. provider absent → 404)", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => "Platform key not found",
    })) as unknown as typeof fetch;

    await expect(resolvePlatformKey("twilio")).rejects.toThrow(
      /platform decrypt failed for provider "twilio": 404/
    );
  });

  it("fails loud when the response carries no key", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ provider: "twilio" }),
    })) as unknown as typeof fetch;

    await expect(resolvePlatformKey("twilio")).rejects.toThrow(
      /returned no platform key/
    );
  });
});
