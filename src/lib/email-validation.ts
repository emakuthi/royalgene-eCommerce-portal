/**
 * One definition of "is this an email", shared by every path that accepts one
 * from user input (signup, register, attendant creation, user edit, platform
 * console).
 *
 * The character class excludes ALL whitespace, not just spaces — a real
 * incident on 2026-09-15 created three duplicate accounts for one person
 * because a multi-line paste ("vaati1995@gmail.com\nsize 36-42\nkes 6500")
 * was stored verbatim: `.trim()` only strips the ends, so embedded newlines
 * survived, and the "one email = one account" uniqueness check compared the
 * full literal string and saw a different value each time.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased and trimmed — the form every email is stored and compared in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** True only for a well-formed address, with no embedded whitespace anywhere. */
export function isValidEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && EMAIL_RE.test(email.trim());
}
