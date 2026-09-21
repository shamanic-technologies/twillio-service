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
  /** Spelled-out identity, all optional on the wire. */
  firstName?: string;
  lastName?: string;
  title?: string;
  city?: string;
  state?: string;
  country?: string;
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

// ─── Identity, and the walk back through the thread ─────────────────────────

/**
 * One earlier message in the thread the reply belongs to, NEWEST-FIRST: entry 0
 * is the email the reply answers. The caller already strips signatures, opt-out
 * footers and quoted history and caps the array, so nothing here re-strips it —
 * only the spoken-length cap applies, same as the reply itself.
 */
export interface PriorMessage {
  direction: "outbound" | "inbound";
  text: string;
}

/** Drop an absent or blank field. Absent is absent — never a placeholder. */
function present(value: string | undefined | null): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The identity, spoken in full right after the reply. Every field is optional on
 * the wire, so the line is assembled from whatever arrived and NEVER says
 * "undefined" or an empty fragment.
 *
 * Returns null when nothing was supplied beyond the name and company the reply
 * detail already spoke — a call placed without the identity fields then sounds
 * exactly as it did before they existed.
 */
export function buildIdentityLine(input: CallScriptInput): string | null {
  const { reply } = input;
  const firstName = present(reply.firstName);
  const lastName = present(reply.lastName);
  const title = present(reply.title);
  const city = present(reply.city);
  const state = present(reply.state);
  const country = present(reply.country);

  if (!firstName && !lastName && !title && !city && !state && !country) {
    return null;
  }

  const spelledName = [firstName, lastName].filter(Boolean).join(" ");
  const who = spelledName || present(reply.name) || "";
  const company = present(reply.company);

  // "Head of Sales at Northwind" / "Head of Sales" / "at Northwind".
  const role = [title, company ? `at ${company}` : undefined]
    .filter(Boolean)
    .join(" ");
  const place = [city, state, country].filter(Boolean).join(", ");

  const parts = [who, role, place ? `in ${place}` : undefined].filter(
    (p) => p && p.length > 0
  );
  return `That is ${parts.join(", ")}.`;
}

/** The identity from the first step back onward: just the name, so it does not get tedious. */
export function buildShortIdentityLine(input: CallScriptInput): string {
  return `Still about ${present(input.reply.name) || "this reply"}.`;
}

/** How a step back is described in the menu, and how the message is introduced. */
function isFirstStep(index: number): boolean {
  return index === 0;
}

/** The menu offer for hearing `priorMessages[index]`, or null when there is none. */
export function buildHearOption(
  prior: PriorMessage[],
  index: number
): string | null {
  if (!Number.isInteger(index) || index < 0 || index >= prior.length) {
    return null;
  }
  return isFirstStep(index)
    ? "Press 2 to hear the email they replied to."
    : "Press 2 to hear the message before that.";
}

/**
 * The menu played after the reply (and after every step back). 1 connects when
 * there is a number to connect to; 2 walks one message further back. The 2
 * option is absent, and not spoken, when there is nothing earlier left.
 */
export function buildMenuPrompt(
  input: CallScriptInput,
  prior: PriorMessage[],
  index: number
): string {
  const hear = buildHearOption(prior, index);
  const lines: string[] = [];

  if (input.hasConnect) {
    lines.push(buildConnectPrompt(input));
  }
  if (hear) {
    lines.push(hear);
  } else if (index > 0) {
    lines.push("There is nothing earlier in this thread.");
  }

  return lines.join(" ");
}

/** Read one earlier message aloud, under the same spoken-length cap as the reply. */
export function buildPriorMessageLine(
  prior: PriorMessage[],
  index: number
): string | null {
  const message = buildHearOption(prior, index) ? prior[index] : null;
  if (!message) return null;

  const body = forSpeech(message.text);
  if (isFirstStep(index) && message.direction === "outbound") {
    return `The email they replied to said: ${body}`;
  }
  return message.direction === "outbound"
    ? `Before that, we wrote: ${body}`
    : `Before that, they wrote: ${body}`;
}
