/**
 * Twilio outbound voice pricing — destination band resolution.
 *
 * Twilio bills voice per minute at a rate set by the destination, and the spread
 * is an order of magnitude (US $0.014/min, France landline $0.0187/min, France
 * mobile $0.1603/min, St Lucia mobile $0.7158/min). costs-service therefore publishes ONE CATALOGUE NAME PER
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
export const VOICE_COST_NAME_LC_LANDLINE =
  "twilio-voice-outbound-minute-lc-landline";
export const VOICE_COST_NAME_LC_MOBILE =
  "twilio-voice-outbound-minute-lc-mobile";

/** Every band this service can declare spend under. */
export const VOICE_COST_NAMES = [
  VOICE_COST_NAME_US,
  VOICE_COST_NAME_FR_LANDLINE,
  VOICE_COST_NAME_FR_MOBILE,
  VOICE_COST_NAME_LC_LANDLINE,
  VOICE_COST_NAME_LC_MOBILE,
] as const;

/**
 * +1 is the North American Numbering Plan, not the United States. Twilio prices
 * the US band as "United States & Canada" at $0.014/min under a bare `1`
 * catch-all, and gives every other NANP country (and two higher-priced US/Canada
 * ranges) its own prefixes and its own rate — St Lucia $0.483-$0.7158/min,
 * Alaska $0.0945/min. So "+1 means US" misprices every one of them.
 *
 * These are the area codes whose Twilio rate is NOT the US & Canada row, read
 * from Twilio's Pricing API (`GET /v2/Voice/Countries/{iso}`, every country,
 * prefixes starting with `1`) on 2026-09-25. A call to one of them is refused
 * unless a band of its own is resolved below — never billed as the US. 658
 * (Jamaica's overlay) is absent from Twilio's listing and is refused anyway:
 * it is Jamaica, whatever the catch-all says.
 */
export const NANP_NON_US_AREA_CODES: Readonly<Record<string, string>> = {
  "242": "Bahamas",
  "246": "Barbados",
  "264": "Anguilla",
  "268": "Antigua & Barbuda",
  "284": "British Virgin Islands",
  "340": "US Virgin Islands",
  "345": "Cayman Islands",
  "441": "Bermuda",
  "473": "Grenada",
  "649": "Turks & Caicos",
  "658": "Jamaica",
  "664": "Montserrat",
  "670": "Northern Mariana Islands",
  "671": "Guam",
  "684": "American Samoa",
  "721": "St. Maarten",
  "758": "St. Lucia",
  "767": "Dominica",
  "784": "St. Vincent & Grenadines",
  "787": "Puerto Rico",
  "809": "Dominican Republic",
  "829": "Dominican Republic",
  "849": "Dominican Republic",
  "867": "Canada - Yukon, Northwest Territories & Nunavut",
  "868": "Trinidad & Tobago",
  "869": "Nevis & St. Kitts",
  "876": "Jamaica",
  "907": "United States - Alaska",
  "939": "Puerto Rico",
};

/**
 * St Lucia mobile ranges, byte-equal to Twilio's "St. Lucia - Mobile" prefixes
 * (Pricing API, 2026-09-25). Twilio prices a St Lucia number by longest prefix:
 * one of these is mobile ($0.7158/min), any other +1 758 number is the landline
 * rate ($0.483/min).
 */
export const LC_MOBILE_PREFIXES: readonly string[] = [
  "1758284", "1758285", "1758286", "1758287", "1758384", "1758460", "1758461",
  "1758481", "1758482", "1758483", "1758484", "1758485", "1758486", "1758487",
  "1758488", "1758489", "1758518", "1758519", "1758520", "1758584", "1758638",
  "1758712", "1758713", "1758714", "1758715", "1758716", "1758717", "1758718",
  "1758719", "1758720", "1758721", "1758722", "1758723", "1758724", "1758725",
  "1758726", "1758727", "1758728", "1758784", "1758785",
];

/**
 * The band a destination falls in. `costName` is null when the band has no
 * catalogue row yet; `band` always names it, so a refusal can say which row is
 * missing.
 */
export interface VoiceBand {
  costName: string | null;
  band: string;
}

/** Strip spacing/punctuation a caller may have left in an E.164 number. */
export function normalizePhone(raw: string): string {
  return raw.trim().replace(/[\s().-]/g, "");
}

/** True for a syntactically valid E.164 number. */
export function isE164(raw: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(normalizePhone(raw));
}

/**
 * Resolve the priced band for a destination. French mobiles are the 06/07
 * ranges (E.164 +336…, +337…); every other French number is priced as a
 * landline — the carrier is not a priced dimension in France. A +1 number is the
 * US band only when its area code is not one Twilio prices differently.
 */
export function resolveVoiceBand(raw: string): VoiceBand {
  const phone = normalizePhone(raw);
  if (!isE164(phone)) return { costName: null, band: "not an E.164 number" };

  if (phone.startsWith("+1")) {
    const digits = phone.slice(1);
    const areaCode = digits.slice(1, 4);
    if (areaCode === "758") {
      return LC_MOBILE_PREFIXES.some((p) => digits.startsWith(p))
        ? { costName: VOICE_COST_NAME_LC_MOBILE, band: "St. Lucia - Mobile" }
        : { costName: VOICE_COST_NAME_LC_LANDLINE, band: "St. Lucia" };
    }
    const other = NANP_NON_US_AREA_CODES[areaCode];
    if (other) return { costName: null, band: other };
    return { costName: VOICE_COST_NAME_US, band: "United States & Canada" };
  }

  if (phone.startsWith("+33")) {
    const nsn = phone.slice(3);
    return /^[67]/.test(nsn)
      ? { costName: VOICE_COST_NAME_FR_MOBILE, band: "France - Mobile" }
      : { costName: VOICE_COST_NAME_FR_LANDLINE, band: "France" };
  }

  return { costName: null, band: "this country" };
}

/** The catalogue cost name for a destination, or null when it has no band. */
export function resolveVoiceCostName(raw: string): string | null {
  return resolveVoiceBand(raw).costName;
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
