/**
 * HTTP client for key-service — the platform's secret store.
 *
 * Mirrors the telegram-service key-resolution pattern: a decrypt call to
 * key-service by provider. This service needs the PLATFORM Twilio credential
 * (one account for the whole platform, not per-org), so it resolves it via the
 * platform-decrypt endpoint (no org/user identity — platform keys are global):
 *
 *   GET /keys/platform/:provider/decrypt   (serviceKeyAuth + caller headers)
 *     → { provider, key }
 *
 * Fails loud: if key-service is not configured, or the provider / platform key
 * does not exist yet, the call throws — there is NO silent fallback to env.
 */

const KEY_SERVICE_URL = process.env.KEY_SERVICE_URL;
const KEY_SERVICE_API_KEY = process.env.KEY_SERVICE_API_KEY;

/**
 * Resolve a decrypted PLATFORM key for a provider from key-service.
 * Fails loud on missing config or an unresolved provider/key.
 */
export async function resolvePlatformKey(provider: string): Promise<string> {
  if (!KEY_SERVICE_URL || !KEY_SERVICE_API_KEY) {
    throw new Error("KEY_SERVICE_URL or KEY_SERVICE_API_KEY not configured");
  }

  const path = `/keys/platform/${encodeURIComponent(provider)}/decrypt`;
  const res = await fetch(`${KEY_SERVICE_URL}${path}`, {
    headers: {
      "x-api-key": KEY_SERVICE_API_KEY,
      "x-caller-service": "twilio-service",
      "x-caller-method": "GET",
      "x-caller-path": path,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `key-service platform decrypt failed for provider "${provider}": ${res.status} ${body}`
    );
  }

  const data = (await res.json()) as { key?: unknown };
  if (typeof data.key !== "string" || !data.key) {
    throw new Error(
      `key-service returned no platform key for provider "${provider}"`
    );
  }
  return data.key;
}
