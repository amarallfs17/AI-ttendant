/** Longest number E.164 allows. */
const MAX_DIGITS = 15;

/** A national number is an area code plus 8 or 9 subscriber digits. */
const NATIONAL_MIN_DIGITS = 10;
const NATIONAL_MAX_DIGITS = 11;

/**
 * Extracts the phone number from an Evolution/Baileys JID.
 *
 * Only `@s.whatsapp.net` JIDs carry a phone number. A `@lid` holds an internal
 * linked-identity number instead, so it resolves to null here — the webhook
 * parser picks the right JID before calling this.
 */
export function normalizePhone(jid: string): string | null {
  const [user] = jid.split("@");
  if (!user || !jid.endsWith("@s.whatsapp.net")) {
    return null;
  }
  const digits = user.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Normalizes a number typed by a person — a CSV cell, not a JID — into the same
 * digits-only form the webhook produces, so both paths key `employees` alike.
 *
 * Length decides whether the country code is missing, never the prefix: the
 * Brazilian area code 55 is indistinguishable from the +55 country code by
 * prefix alone, and guessing wrong would register an unreachable number.
 * A number shorter than an area code plus subscriber digits is rejected rather
 * than padded, since nobody can dial it.
 */
export function normalizeRawPhone(raw: string, countryCode: string): string | null {
  // A leading zero is a local dialling habit, never part of the number.
  const digits = raw.replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return null;

  const isNational =
    digits.length >= NATIONAL_MIN_DIGITS && digits.length <= NATIONAL_MAX_DIGITS;
  const normalized = isNational ? `${countryCode}${digits}` : digits;

  // The floor follows the country code's own length: +55 needs 12 digits, +1
  // needs 11. Hardcoding one of them would reject valid numbers elsewhere.
  const minLength = countryCode.length + NATIONAL_MIN_DIGITS;
  if (normalized.length < minLength || normalized.length > MAX_DIGITS) {
    return null;
  }

  return normalized;
}
