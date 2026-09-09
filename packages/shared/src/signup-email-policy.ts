/**
 * Who may open a laboratory account without talking to us.
 *
 * Self-serve sign-up is restricted to an e-mail at the laboratory's OWN
 * domain. A free-provider address (gmail, uol, hotmail…) is refused, for two
 * reasons that are not about snobbery:
 *
 * - It is the cheapest real signal that there is a company behind the sign-up.
 *   Anyone can create a gmail address in a minute; a domain costs money, needs
 *   DNS, and ties the account to an organization that exists.
 * - The product sends certificates and portal invitations from — and about —
 *   the lab's identity. An account rooted in a personal mailbox has no owner
 *   once that person leaves, which is exactly the kind of orphan record an
 *   ISO/IEC 17025 audit trail should not have.
 *
 * A lab without its own domain is not refused as a customer, only as a
 * *self-serve* one: the page routes it to the team instead.
 *
 * The list below is a floor, not a fence — it cannot be exhaustive, and it is
 * not a security control. Real abuse resistance comes from the MX check and
 * rate limiting on the route that uses this.
 */

/** Free consumer mailboxes, global and Brazilian. */
const PUBLIC_PROVIDER_DOMAINS: ReadonlySet<string> = new Set([
  // Global
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "live.com.br",
  "msn.com",
  "yahoo.com",
  "yahoo.com.br",
  "ymail.com",
  "rocketmail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "gmx.com",
  "gmx.net",
  "mail.com",
  "mail.ru",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  // Brazil
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
  "globomail.com",
  "r7.com",
  "oi.com.br",
  "superig.com.br",
  "pop.com.br",
  "zipmail.com.br",
  "click21.com.br",
  "brturbo.com.br",
  "itelefonica.com.br",
  "veloxmail.com.br",
  "hotmail.es",
]);

/** Throwaway inboxes. Same treatment, different message. */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "sharklasers.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "throwawaymail.com",
  "maildrop.cc",
  "fakeinbox.com",
  "mailnesia.com",
  "spamgourmet.com",
  "mytemp.email",
  "moakt.com",
  "emailondeck.com",
]);

export type SignupEmailRejection =
  | "invalid_format"
  | "public_provider"
  | "disposable";

export type SignupEmailCheck =
  | { ok: true; email: string; domain: string }
  | { ok: false; reason: SignupEmailRejection; domain: string };

/** Lowercased domain of an address, or "" when it is not one. */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  return email
    .slice(at + 1)
    .trim()
    .toLowerCase();
}

/**
 * Decides whether an address may open a self-serve account. Deliberately
 * pure and offline: the DNS/MX side lives with the route, so this stays
 * testable and usable from the browser for instant feedback.
 */
export function checkSignupEmail(rawEmail: string): SignupEmailCheck {
  const email = rawEmail.trim().toLowerCase();
  const domain = emailDomain(email);

  // Not a full-blown RFC check — the schema layer already validates shape.
  // This only needs the domain to be a real hostname: two or more labels, each
  // starting and ending alphanumeric, under an alphabetic TLD. A label may not
  // start or end with a hyphen, which is what rejects "-.com".
  const labels = domain.split(".");
  const looksLikeDomain =
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) &&
    /^[a-z]{2,}$/.test(labels[labels.length - 1] ?? "");

  if (!looksLikeDomain) {
    return { ok: false, reason: "invalid_format", domain };
  }

  if (PUBLIC_PROVIDER_DOMAINS.has(domain)) {
    return { ok: false, reason: "public_provider", domain };
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, reason: "disposable", domain };
  }

  return { ok: true, email, domain };
}

/** pt-BR copy for each refusal, shown on the sign-up form and by the API. */
export const SIGNUP_EMAIL_REJECTION_MESSAGES: Record<
  SignupEmailRejection,
  string
> = {
  invalid_format: "Informe um e-mail válido.",
  public_provider:
    "Use o e-mail do domínio do seu laboratório. Endereços pessoais (Gmail, Outlook, UOL) não são aceitos.",
  disposable:
    "Este endereço é de e-mail temporário. Use o e-mail do domínio do seu laboratório.",
};

/** True when the address may open a self-serve account. */
export function isCorporateSignupEmail(email: string): boolean {
  return checkSignupEmail(email).ok;
}
