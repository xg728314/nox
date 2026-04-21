/**
 * OTP length constants for the login device-verification flow.
 *
 * Why two:
 *   - Email OTP is issued by Supabase `auth.signInWithOtp` and verified via
 *     `auth.verifyOtp({ type: "email" })`. Supabase currently generates an
 *     8-character token for email/recovery flows, so the UI label and local
 *     validation must accept 8 digits. Single source of truth here so UI and
 *     server route can't drift again.
 *   - TOTP is RFC 6238 and always 6 digits — kept as a distinct constant so
 *     the email-length change here never leaks into TOTP enforcement.
 *
 * Both values are digits-only (0-9). If Supabase changes the token length
 * in the future, update EMAIL_OTP_LENGTH here — nothing else downstream
 * hardcodes a number.
 */

export const EMAIL_OTP_LENGTH = 8
export const TOTP_CODE_LENGTH = 6

/** Matches exactly `EMAIL_OTP_LENGTH` decimal digits. */
export const EMAIL_OTP_REGEX = new RegExp(`^\\d{${EMAIL_OTP_LENGTH}}$`)
