import twilio from "twilio";
import type { MessageInstance } from "twilio/lib/rest/api/v2010/account/message";

// Cache clients per account for multi-project support
const clients: Map<string, twilio.Twilio> = new Map();

function getClient(): twilio.Twilio {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required");
  }

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
  const client = getClient();

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

/**
 * Get message details from Twilio
 */
export async function getMessageDetails(messageSid: string) {
  const client = getClient();
  try {
    return await client.messages(messageSid).fetch();
  } catch (error: any) {
    console.error("Twilio getMessageDetails error:", error);
    throw error;
  }
}

/**
 * Validate that a Twilio webhook request is authentic
 */
export function validateWebhookSignature(
  signature: string,
  url: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  return twilio.validateRequest(authToken, signature, url, params);
}
