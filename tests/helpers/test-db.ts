import { randomUUID } from "crypto";

/**
 * Generate a fake Twilio message SID for testing
 */
export function generateMessageSid(): string {
  return `SM${randomUUID().replace(/-/g, "")}`;
}

/**
 * Generate a test UUID
 */
export function generateUUID(): string {
  return randomUUID();
}
