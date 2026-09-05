/**
 * Spoken script for an outbound call.
 *
 * The call opens with a SUMMARY (why the phone is ringing) and asks for a
 * keypress. Nothing else is spoken until that key arrives, so an answering
 * machine hears only the summary and the call is never recorded as taken. The
 * DETAIL (who replied, which company, what they wrote) plays after the keypress,
 * and the connect offer, when there is a number to connect to, needs a second
 * deliberate keypress of its own.
 */

export interface CallReply {
  /** Who replied. */
  name: string;
  /** Their company, when known. */
  company?: string;
  /** What they actually wrote. */
  message: string;
}

export interface CallScriptInput {
  reply: CallReply;
  /** The brand whose campaign was replied to, spoken in the opener. */
  brandName?: string;
  /** Who the second keypress bridges to, when different from the replier. */
  connectName?: string;
  /** Whether a number to connect to was supplied. */
  hasConnect: boolean;
}

/**
 * Text-to-speech reads the whole reply aloud and every started minute is billed,
 * so a very long reply is trimmed rather than dictated in full.
 */
export const MAX_SPOKEN_MESSAGE_CHARS = 600;

/** Collapse whitespace and trim an over-long reply for speech. */
export function forSpeech(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_SPOKEN_MESSAGE_CHARS) return flat;
  return `${flat.slice(0, MAX_SPOKEN_MESSAGE_CHARS).trimEnd()}, and it goes on.`;
}

/** The opener, played before any keypress. Asks for the accept keypress. */
export function buildSummary(input: CallScriptInput): string {
  const forBrand = input.brandName ? ` for ${input.brandName}` : "";
  return (
    `Hello. This is Distribute${forBrand}. ` +
    "A prospect just replied to your outreach campaign and they are interested. " +
    "Press 1 to take this call."
  );
}

/** The detail, played only once the call has been taken. */
export function buildDetail(input: CallScriptInput): string {
  const { name, company, message } = input.reply;
  const who = company ? `${name} from ${company}` : name;
  return `${who} replied to your campaign. They wrote: ${forSpeech(message)}`;
}

/** The connect offer, played when a number to connect to was supplied. */
export function buildConnectPrompt(input: CallScriptInput): string {
  const who = input.connectName || input.reply.name;
  return `Press 1 now to be connected to ${who}.`;
}

/**
 * Spoken instead of the connect offer when no number to connect to was
 * supplied. The absence is stated in words rather than silently omitted.
 */
export function buildNoConnectLine(input: CallScriptInput): string {
  const who = input.connectName || input.reply.name;
  return (
    `We do not have a phone number for ${who}, ` +
    "so I cannot connect you on this call."
  );
}
