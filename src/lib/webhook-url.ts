/**
 * Twilio signs a webhook request with the exact URL it called, so every webhook
 * URL we hand Twilio and every URL we validate a signature against must be built
 * the same way: the service public URL joined with the route path (plus its
 * query string, which Twilio includes in the signature).
 *
 * Fails loud when the public URL is not configured — a signature cannot be
 * trusted against a URL we guessed.
 */
export function buildWebhookUrl(pathWithQuery: string): string {
  const base = process.env.TWILIO_SERVICE_PUBLIC_URL;
  if (!base) throw new Error("TWILIO_SERVICE_PUBLIC_URL not configured");
  return `${base.replace(/\/+$/, "")}${pathWithQuery}`;
}
