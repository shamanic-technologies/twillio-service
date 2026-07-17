import twilio from "twilio";
import type { MessageInstance } from "twilio/lib/rest/api/v2010/account/message";
import { resolvePlatformKey } from "./key-client";

// The platform Twilio credential lives in key-service under the "twilio"
// provider (one account for the whole platform, not per-org). Its decrypted
// value is a JSON blob { accountSid, authToken }.
const TWILIO_KEY_PROVIDER = "twilio";

interface TwilioCredentials {
  accountSid: string;
  authToken: string;
}

// Resolve the platform Twilio credential from key-service exactly once and cache
// the promise. Fails loud if the "twilio" provider / platform key is absent —
// there is NO silent fallback to env.
let credsPromise: Promise<TwilioCredentials> | null = null;

async function resolveTwilioCredentials(): Promise<TwilioCredentials> {
  if (!credsPromise) {
    credsPromise = (async () => {
      const raw = await resolvePlatformKey(TWILIO_KEY_PROVIDER);
      let parsed: { accountSid?: unknown; authToken?: unknown };
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          'Twilio platform key is not valid JSON (expected { accountSid, authToken })'
        );
      }
      const { accountSid, authToken } = parsed;
      if (
        typeof accountSid !== "string" ||
        !accountSid ||
        typeof authToken !== "string" ||
        !authToken
      ) {
        throw new Error(
          "Twilio platform key missing accountSid and/or authToken"
        );
      }
      return { accountSid, authToken };
    })().catch((err) => {
      // Allow a retry on the next call rather than caching the failure.
      credsPromise = null;
      throw err;
    });
  }
  return credsPromise;
}

// Cache clients per account SID.
const clients: Map<string, twilio.Twilio> = new Map();

async function getClient(): Promise<twilio.Twilio> {
  const { accountSid, authToken } = await resolveTwilioCredentials();

  if (!clients.has(accountSid)) {
    clients.set(accountSid, twilio(accountSid, authToken));
  }

  return clients.get(accountSid)!;
}

export interface SendSmsParams {
  from: string;
  to: string;
  body: string;
  statusCallback?: string;
  project?: "mcpfactory" | "pressbeat";
}

export interface SendSmsResult {
  success: boolean;
  messageSid?: string;
  status?: string;
  numSegments?: string;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Get the default "from" phone number for a project
 */
export function getFromNumber(project?: "mcpfactory" | "pressbeat"): string {
  if (project === "pressbeat") {
    const num = process.env.TWILIO_PRESSBEAT_PHONE_NUMBER;
    if (!num) throw new Error("TWILIO_PRESSBEAT_PHONE_NUMBER not configured");
    return num;
  }
  const num =
    process.env.TWILIO_MCPFACTORY_PHONE_NUMBER ||
    process.env.TWILIO_PHONE_NUMBER;
  if (!num) throw new Error("TWILIO_MCPFACTORY_PHONE_NUMBER not configured");
  return num;
}

/**
 * Send an SMS via Twilio
 */
export async function sendSms(
  params: SendSmsParams
): Promise<SendSmsResult> {
  const client = await getClient();

  try {
    const message: MessageInstance = await client.messages.create({
      from: params.from,
      to: params.to,
      body: params.body,
      statusCallback: params.statusCallback,
    });

    return {
      success: true,
      messageSid: message.sid,
      status: message.status,
      numSegments: message.numSegments,
    };
  } catch (error: any) {
    console.error("Twilio send error:", error);
    return {
      success: false,
      errorCode: error.code || -1,
      errorMessage: error.message || "Unknown error",
    };
  }
}

// ─── WhatsApp ────────────────────────────────────────────────────────────────

/**
 * Normalize a Twilio WhatsApp address to a bare E.164 phone number.
 * Twilio sends WhatsApp participants as "whatsapp:+14155551234"; strip the
 * channel prefix and surrounding whitespace so it can be used as a stable key.
 */
export function normalizeWhatsAppPhone(address: string): string {
  return address.trim().replace(/^whatsapp:/i, "").trim();
}

// Code-owned WhatsApp sender address. The Twilio sandbox number for now; swap to
// the production WhatsApp sender number here once the Twilio WhatsApp Sender is
// registered and live.
const WHATSAPP_FROM_NUMBER = "whatsapp:+14155238886";

/**
 * Get the platform WhatsApp sender number (E.164) for outbound replies, without
 * the "whatsapp:" prefix.
 */
export function getWhatsAppFromNumber(): string {
  return normalizeWhatsAppPhone(WHATSAPP_FROM_NUMBER);
}

export interface SendWhatsAppParams {
  /** E.164 sender, with or without the "whatsapp:" prefix. */
  from: string;
  /** E.164 recipient, with or without the "whatsapp:" prefix. */
  to: string;
  body: string;
  statusCallback?: string;
}

/**
 * Send a WhatsApp message via Twilio. Uses the same Messages API as SMS with the
 * WhatsApp channel — Twilio requires both addresses prefixed with "whatsapp:".
 */
export async function sendWhatsApp(
  params: SendWhatsAppParams
): Promise<SendSmsResult> {
  const client = await getClient();

  const from = `whatsapp:${normalizeWhatsAppPhone(params.from)}`;
  const to = `whatsapp:${normalizeWhatsAppPhone(params.to)}`;

  try {
    const message: MessageInstance = await client.messages.create({
      from,
      to,
      body: params.body,
      statusCallback: params.statusCallback,
    });

    return {
      success: true,
      messageSid: message.sid,
      status: message.status,
      numSegments: message.numSegments,
    };
  } catch (error: any) {
    console.error("Twilio WhatsApp send error:", error);
    return {
      success: false,
      errorCode: error.code || -1,
      errorMessage: error.message || "Unknown error",
    };
  }
}

/**
 * Get message details from Twilio
 */
export async function getMessageDetails(messageSid: string) {
  const client = await getClient();
  try {
    return await client.messages(messageSid).fetch();
  } catch (error: any) {
    console.error("Twilio getMessageDetails error:", error);
    throw error;
  }
}

/**
 * Validate that a Twilio webhook request is authentic. Uses the platform auth
 * token resolved from key-service (same credential as the REST client).
 */
export async function validateWebhookSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): Promise<boolean> {
  const { authToken } = await resolveTwilioCredentials();
  return twilio.validateRequest(authToken, signature, url, params);
}
