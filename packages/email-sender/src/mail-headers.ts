/**
 * The one copy of the e-mail header helpers (From, Reply-To, Subject).
 *
 * A header value built from tenant data (a laboratory name, a support address,
 * a subject with an organization name in it) must never carry a line break, or
 * the value becomes a header-injection vector. Every sender goes through these
 * functions; do not re-implement them next to a template.
 */

/** The brand fields a header needs: structural, so no template package is imported. */
export interface MailHeaderBrand {
  name: string;
  supportEmail?: string;
  isWhiteLabel?: boolean;
}

/** A header value on one line: line breaks become spaces. */
export function sanitizeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** The bare address of `Name <address>`, or the trimmed value itself. */
export function getEmailAddress(value: string): string {
  // Index scan, not a regex: linear on any input (CodeQL js/polynomial-redos).
  const open = value.indexOf("<");
  const close = open === -1 ? -1 : value.indexOf(">", open + 1);
  if (close > open + 1) return value.slice(open + 1, close).trim();
  return value.trim();
}

/**
 * From-header for the shared platform envelope: a white-label brand is shown as
 * "Lab via CalibraFácil <platform address>"; anything else is the platform
 * address untouched.
 */
export function formatFromEmail(
  fromEmail: string,
  brand: MailHeaderBrand | undefined,
): string {
  if (!brand?.isWhiteLabel) return fromEmail;
  return `${sanitizeMailHeader(brand.name)} via CalibraFácil <${getEmailAddress(fromEmail)}>`;
}

/** From-header for the lab's own domain — no "via CalibraFácil". */
export function formatLabFromHeader(
  displayName: string,
  fromAddress: string,
): string {
  const name = displayName.replace(/[\r\n"]+/g, " ").trim();
  return `${name} <${fromAddress}>`;
}

/** Reply-To is the brand's support address when it looks like one. */
export function getReplyToEmail(
  brand: MailHeaderBrand | undefined,
): string | undefined {
  const email = brand?.supportEmail?.trim();
  if (!email || !email.includes("@")) return undefined;
  return sanitizeMailHeader(email);
}

/** Platform-variant brand (shared envelope): see the fallback semantics in send.ts. */
export function stripBrandSender<B extends { name: string; sender?: unknown }>(
  brand: B | undefined,
): B | undefined {
  if (!brand?.sender) return brand;
  return { ...brand, sender: undefined };
}
