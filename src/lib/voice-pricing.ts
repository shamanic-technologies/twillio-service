/**
 * Twilio outbound voice pricing — destination band resolution.
 *
 * Twilio bills voice per minute at a rate set by the destination, and the spread
 * is an order of magnitude (US $0.014/min, France landline $0.0187/min, France
 * mobile $0.1603/min). costs-service therefore publishes ONE CATALOGUE NAME PER
 * BAND rather than a blended one, and the caller resolves the name from the
 * number it dialled. These strings are byte-equal to the costs-service catalogue
 * rows; runs-service 422-rejects anything else.
 *
 * A destination we have no band for is NOT billed under a neighbouring one — the
 * call is refused before it is placed, and the fix is a new row in
 * costs-service's catalogue, never a wider reading of an existing band.
 */

export const VOICE_COST_NAME_US = "twilio-voice-outbound-minute-us";
export const VOICE_COST_NAME_FR_LANDLINE =
  "twilio-voice-outbound-minute-fr-landline";
export const VOICE_COST_NAME_FR_MOBILE =
  "twilio-voice-outbound-minute-fr-mobile";

/** Every band this service can declare spend under. */
export const VOICE_COST_NAMES = [
  VOICE_COST_NAME_US,
  VOICE_COST_NAME_FR_LANDLINE,
  VOICE_COST_NAME_FR_MOBILE,
] as const;

/** Strip spacing/punctuation a caller may have left in an E.164 number. */
export function normalizePhone(raw: string): string {
  return raw.trim().replace(/[\s().-]/g, "");
}

/** True for a syntactically valid E.164 number. */
export function isE164(raw: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(normalizePhone(raw));
}

/**
 * Resolve the catalogue cost name for a destination, or null when we have no
 * published band for it. French mobiles are the 06/07 ranges (E.164 +336…,
 * +337…); every other French number is priced as a landline. The carrier is not
 * a priced dimension in France, so it does not enter the resolution.
 */
export function resolveVoiceCostName(raw: string): string | null {
  const phone = normalizePhone(raw);
  if (!isE164(phone)) return null;

  if (phone.startsWith("+1")) return VOICE_COST_NAME_US;

  if (phone.startsWith("+33")) {
    const nsn = phone.slice(3);
    return /^[67]/.test(nsn)
      ? VOICE_COST_NAME_FR_MOBILE
      : VOICE_COST_NAME_FR_LANDLINE;
  }

  return null;
}

/**
 * Minutes to declare for a leg of `durationSeconds`. Twilio bills a started
 * minute in full, so a 5-second call is one billed minute; a leg that never
 * connected has no duration and costs nothing.
 */
export function billedMinutes(durationSeconds: number | null): number {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) return 0;
  if (durationSeconds <= 0) return 0;
  return Math.ceil(durationSeconds / 60);
}
