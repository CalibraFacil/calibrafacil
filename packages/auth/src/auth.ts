import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { randomBytes } from "node:crypto";
import { getDb } from "@calibra-facil/db";
import * as schema from "@calibra-facil/db/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { admin as adminPlugin, organization } from "better-auth/plugins";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { twoFactor } from "better-auth/plugins/two-factor";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { Resend } from "resend";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/server";
import {
  EmailConfirmationEmail,
  LabAccessLinkEmail,
  LabOtpEmail,
  OrganizationInvitationEmail,
  PasswordResetEmail,
  PortalInvitationEmail,
  PortalMagicLinkEmail,
  type EmailBrand,
} from "@calibra-facil/email";
import { hasEntitlement } from "@calibra-facil/shared";
import {
  PORTAL_ACCESS_ROLES,
  ac,
  platformAc,
  platformRoles,
  roles,
} from "./access";
import {
  hasActiveLabMembership,
  hasPendingLabInvitation,
  hasValidLabSetupTokenForEmail,
  normalizeLabAccessEmail,
  validateLabAccountSetupToken,
} from "./lab-access";
import { assertOrganizationUserLimit } from "./plan-user-limit";

export {
  assertOrganizationUserLimit,
  getOrganizationProvisionedUserCount,
} from "./plan-user-limit";

export type BetterAuthPasskeyPortableTypes =
  | AuthenticationResponseJSON
  | PublicKeyCredentialCreationOptionsJSON
  | PublicKeyCredentialRequestOptionsJSON;

let devFallbackAuthSecret: string | null = null;
const IMPERSONATION_HANDOFF_TOKEN_EXPIRES_IN_SECONDS = 60;

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function getRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function getEmailLogoSrc(): string {
  const explicitLogoUrl = readEnv("EMAIL_LOGO_URL");
  if (explicitLogoUrl) return explicitLogoUrl;

  const appUrl = readEnv("APP_URL") ?? readEnv("WEB_URL");
  if (appUrl) return `${appUrl.replace(/\/$/, "")}/logo192.png`;

  return "https://calibrafacil.com/logo192.png";
}

function resolveApiBaseUrl(fallback: string): string {
  return readEnv("API_URL") ?? fallback;
}

function resolveWebBaseUrl(isProduction: boolean): string {
  return (
    readEnv("APP_URL") ??
    readEnv("WEB_URL") ??
    (isProduction ? "https://calibrafacil.com" : "http://localhost:5173")
  );
}

function resolveEmailVerificationUrl(url: string, webBaseUrl: string): string {
  try {
    const verificationUrl = new URL(url);
    const callbackURL = verificationUrl.searchParams.get("callbackURL");

    if (
      !callbackURL ||
      !callbackURL.startsWith("/") ||
      callbackURL.startsWith("//")
    ) {
      return url;
    }

    verificationUrl.searchParams.set(
      "callbackURL",
      new URL(callbackURL, webBaseUrl).toString(),
    );

    return verificationUrl.toString();
  } catch {
    return url;
  }
}

function isLocalDevelopmentUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || isPrivateIpv4(hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isProductionLikeUrl(value: string | undefined): boolean {
  if (!value) return false;

  try {
    const { protocol, hostname } = new URL(value);
    // dev-*.calibrafacil.com is a reserved prefix for dev tunnels (e.g.
    // dev-portal, dev-web). Never treat those as production-like, even
    // though they are https:.
    if (/^dev-[\w-]+\.calibrafacil\.com$/.test(hostname.toLowerCase())) {
      return false;
    }
    return protocol === "https:" && !isLocalDevelopmentUrl(value)
      ? !hostname.endsWith(".local")
      : false;
  } catch {
    return false;
  }
}

function isProductionRuntime(): boolean {
  const runtimeEnv = readEnv("NODE_ENV") ?? readEnv("APP_ENV");

  // Explicit env always wins. A common dev workflow runs the local API behind a
  // Cloudflare/ngrok tunnel so `API_URL`/`APP_URL` look production-like
  // (`https://dev-api.calibrafacil.com`) even though the process is the local
  // one with `NODE_ENV=development`. URL-based inference must not override that.
  if (runtimeEnv === "development" || runtimeEnv === "test") {
    return false;
  }
  if (runtimeEnv === "production") {
    return true;
  }

  // No explicit runtime env: fall back to URL inference.
  const configuredUrls = [readEnv("API_URL"), readEnv("APP_URL")];

  if (configuredUrls.some(isLocalDevelopmentUrl)) {
    return false;
  }

  if (configuredUrls.some(isProductionLikeUrl)) {
    return true;
  }

  if (runtimeEnv) {
    return runtimeEnv !== "development" && runtimeEnv !== "test";
  }

  return false;
}

function createBaseUrlConfig(
  isProduction: boolean,
): string | { allowedHosts: string[]; protocol?: "http" | "https" | "auto" } {
  if (isProduction) {
    return getRequiredEnv("API_URL");
  }

  // Dev: dynamic per-request resolution from the incoming Host header.
  // The same list is automatically added to trustedOrigins by better-auth,
  // so magic-link URLs and origin trust both derive from the tunnel hostname
  // the user actually hit (dev-portal vs dev-web), with no extra rewriting.
  return {
    allowedHosts: [
      "localhost:3000",
      "localhost:5173",
      "localhost:5174",
      "*.calibrafacil.com",
    ],
    protocol: "auto",
  };
}

function getCookieDomainFromApiUrl(apiUrl: string | undefined): string | null {
  if (!apiUrl) return null;

  try {
    const { hostname } = new URL(apiUrl);
    return hostname.endsWith(".calibrafacil.com") ? ".calibrafacil.com" : null;
  } catch {
    return null;
  }
}

function shouldUseCrossSubDomainCookies(
  isProduction: boolean,
  apiUrl: string | undefined,
  cookieDomain: string | null,
) {
  if (!cookieDomain || !apiUrl) return false;
  if (isProduction) return true;

  try {
    const url = new URL(apiUrl);
    return (
      url.protocol === "https:" && url.hostname.endsWith(".calibrafacil.com")
    );
  } catch {
    return false;
  }
}

function getDevFallbackAuthSecret(): string {
  if (devFallbackAuthSecret) {
    return devFallbackAuthSecret;
  }

  devFallbackAuthSecret = randomBytes(32).toString("base64");
  return devFallbackAuthSecret;
}

function allowsDevFallbackAuthSecret(isProduction: boolean): boolean {
  if (isProduction) {
    return false;
  }

  const runtimeEnv = readEnv("NODE_ENV") ?? readEnv("APP_ENV");
  const configuredUrls = [readEnv("API_URL"), readEnv("APP_URL")].filter(
    Boolean,
  );

  return (
    runtimeEnv === "development" ||
    runtimeEnv === "test" ||
    configuredUrls.length === 0 ||
    configuredUrls.some(isLocalDevelopmentUrl)
  );
}

function resolveAuthSecret(isProduction: boolean): string {
  const configuredSecret = readEnv("BETTER_AUTH_SECRET");

  if (configuredSecret && configuredSecret.length >= 32) {
    return configuredSecret;
  }

  if (!allowsDevFallbackAuthSecret(isProduction)) {
    if (!configuredSecret) {
      throw new Error("BETTER_AUTH_SECRET environment variable is required");
    }
    throw new Error(
      "BETTER_AUTH_SECRET must be at least 32 characters long outside local development",
    );
  }

  if (configuredSecret && configuredSecret.length < 32) {
    console.warn(
      "BETTER_AUTH_SECRET is shorter than 32 chars in development; using a secure in-memory fallback secret",
    );
  }

  return getDevFallbackAuthSecret();
}

const DEV_TRUSTED_ORIGINS = [
  "app://calibra-facil",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "https://localhost:5173",
  "https://localhost:5174",
  "https://localhost:5175",
  "https://dev-web.calibrafacil.com",
  "https://dev-portal.calibrafacil.com",
  "https://dev-ops.calibrafacil.com",
  "https://dev-api.calibrafacil.com",
  "http://192.168.0.10:5173",
  "http://192.168.0.10:5174",
  "http://192.168.0.10:5175",
  "https://192.168.0.10:5173",
  "https://192.168.0.10:5174",
  "https://192.168.0.10:5175",
  "https://dev-portal.calibrafacil.com",
  "https://dev-web.calibrafacil.com",
];

const PROD_TRUSTED_ORIGINS = [
  "app://calibra-facil",
  "https://calibrafacil.com",
  "https://www.calibrafacil.com",
  "https://portal.calibrafacil.com",
  "https://ops.calibrafacil.com",
];

type AuthSurface = "lab" | "backoffice" | "portal";

function isIpv4Address(hostname: string): boolean {
  const parts = hostname.split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) {
      return false;
    }

    const value = Number(part);
    return value >= 0 && value <= 255;
  });
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Address(hostname)) return false;

  const [first = -1, second = -1] = hostname
    .split(".")
    .map((segment) => Number(segment));

  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function normalizeDynamicTrustedOrigin(
  candidate: string | null,
  isProduction: boolean,
): string | null {
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" &&
      (isProduction || url.protocol !== "http:")
    ) {
      return null;
    }

    if (isProduction) {
      if (
        hostname === "localhost" ||
        hostname.endsWith(".local") ||
        isPrivateIpv4(hostname)
      ) {
        return null;
      }
    }

    return url.origin;
  } catch {
    return null;
  }
}

function createTrustedOrigins(
  isProduction: boolean,
  surface: AuthSurface,
): string[] | ((request?: Request) => Promise<string[]>) {
  const baseOrigins = isProduction ? PROD_TRUSTED_ORIGINS : DEV_TRUSTED_ORIGINS;

  return async (request?: Request) => {
    const origins = new Set(baseOrigins);
    const requestUrl = request ? new URL(request.url) : null;
    const issuerOrigin = normalizeDynamicTrustedOrigin(
      request?.headers.get("x-sso-issuer-origin") ?? null,
      isProduction,
    );

    const requestOrigin = normalizeDynamicTrustedOrigin(
      request?.headers.get("origin") ?? null,
      isProduction,
    );

    if (issuerOrigin) {
      origins.add(issuerOrigin);
    }

    if (
      requestOrigin &&
      ((!isProduction && isPrivateDevWebOrigin(requestOrigin)) ||
        (surface === "portal" &&
          (await isActivePortalCustomOrigin(requestOrigin))))
    ) {
      origins.add(requestOrigin);
    }

    for (const callbackParam of [
      "callbackURL",
      "newUserCallbackURL",
      "errorCallbackURL",
    ]) {
      const callbackOrigin = normalizeDynamicTrustedOrigin(
        requestUrl?.searchParams.get(callbackParam) ?? null,
        isProduction,
      );

      if (
        callbackOrigin &&
        surface === "portal" &&
        (await isActivePortalCustomOrigin(callbackOrigin))
      ) {
        origins.add(callbackOrigin);
      }
    }

    return [...origins];
  };
}

function isPrivateDevWebOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || isPrivateIpv4(url.hostname)) &&
      (url.port === "5173" || url.port === "5174" || url.port === "5175")
    );
  } catch {
    return false;
  }
}

async function isActivePortalCustomOrigin(origin: string): Promise<boolean> {
  try {
    const url = new URL(origin);
    const record = await getDb().query.organizationCustomDomain.findFirst({
      where: and(
        eq(
          schema.organizationCustomDomain.hostname,
          url.hostname.toLowerCase(),
        ),
        eq(schema.organizationCustomDomain.isActive, true),
      ),
    });

    if (!record?.organizationId || !record.verifiedAt) {
      return false;
    }

    const currentSubscription = await getDb().query.subscription.findFirst({
      where: eq(schema.subscription.organizationId, record.organizationId),
    });

    const planId = currentSubscription?.planId ?? "FREE";
    return hasEntitlement(planId, "custom_domain");
  } catch {
    return false;
  }
}

function sanitizeMailHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function getEmailAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1]?.trim() ?? value.trim();
}

function formatFromEmail(fromEmail: string, brand: EmailBrand | undefined) {
  if (!brand?.isWhiteLabel) return fromEmail;

  return `${sanitizeMailHeader(brand.name)} via CalibraFácil <${getEmailAddress(fromEmail)}>`;
}

function getReplyToEmail(brand: EmailBrand | undefined): string | undefined {
  const email = brand?.supportEmail?.trim();
  if (!email || !email.includes("@")) return undefined;
  return sanitizeMailHeader(email);
}

/**
 * Send a transactional email through Resend and FAIL LOUDLY on a provider error.
 *
 * The Resend SDK resolves `emails.send()` with `{ data, error }` rather than
 * throwing when the Resend API rejects a message (invalid/rotated key, unverified
 * sender domain, suppressed recipient, quota/rate limit). Every auth email below
 * previously discarded that result, so a total delivery outage surfaced as a
 * silent HTTP 200 with nothing logged — undetectable until users reported it.
 * Surfacing the error (log + throw → 5xx) makes a provider rejection observable
 * instead of invisible.
 */
async function sendResend(
  resend: Resend,
  payload: Parameters<Resend["emails"]["send"]>[0],
): Promise<void> {
  const { error } = await resend.emails.send(payload);
  if (error) {
    console.error("[Resend] Email delivery failed", error);
    throw new Error(`Resend email delivery failed: ${error.message}`);
  }
}

function readCallbackUrlFromMagicLinkContext(ctx: unknown): string | null {
  if (!ctx || typeof ctx !== "object" || !("body" in ctx)) return null;

  const body = toRecord(toRecord(ctx).body);
  const callbackURL = body?.callbackURL;

  return typeof callbackURL === "string" ? callbackURL : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function readInvitationIdFromCallbackUrl(
  callbackURL: string | null,
): string | null {
  if (!callbackURL) return null;

  try {
    const url = new URL(callbackURL);
    const token = url.searchParams.get("token")?.trim();

    if (url.pathname !== "/accept-invite" || !token) {
      return null;
    }

    return token;
  } catch {
    return null;
  }
}

async function findPendingPortalInvitation(
  email: string,
  invitationId?: string | null,
) {
  const conditions = [
    eq(schema.invitation.email, email),
    eq(schema.invitation.status, "pending"),
    gt(schema.invitation.expiresAt, new Date()),
    eq(schema.organization.type, "CLIENT"),
  ];

  if (invitationId) {
    conditions.push(eq(schema.invitation.id, invitationId));
  }

  const [pendingInvitation] = await getDb()
    .select({
      id: schema.invitation.id,
      email: schema.invitation.email,
      role: schema.invitation.role,
      organizationId: schema.organization.id,
      organizationName: schema.organization.name,
    })
    .from(schema.invitation)
    .innerJoin(
      schema.organization,
      eq(schema.invitation.organizationId, schema.organization.id),
    )
    .where(and(...conditions))
    .limit(1);

  return pendingInvitation ?? null;
}

function formatLabAddress(lab: {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
}): string | undefined {
  const streetLine = [lab.street, lab.number, lab.complement]
    .filter(Boolean)
    .join(", ");
  const cityLine = [
    lab.neighbourhood,
    [lab.city, lab.state].filter(Boolean).join(" - "),
    lab.cep ? `CEP ${lab.cep}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
  const address = [streetLine, cityLine].filter(Boolean).join(" · ");

  return address || undefined;
}

function createLabEmailBrand(lab: {
  name: string;
  logo: string | null;
  cnpj: string | null;
  accreditationNumber: string | null;
  accreditationBody: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
}): EmailBrand {
  const accreditation = [lab.accreditationBody, lab.accreditationNumber]
    .filter(Boolean)
    .join(" ");
  const legalLines = [
    lab.cnpj ? `CNPJ ${lab.cnpj}` : undefined,
    accreditation ? `Acreditação ${accreditation}` : undefined,
    formatLabAddress(lab),
    lab.phone ? `Telefone: ${lab.phone}` : undefined,
  ].filter((line): line is string => Boolean(line));

  return {
    name: lab.name,
    logoSrc: lab.logo ?? getEmailLogoSrc(),
    footerLegalLines: legalLines,
    supportEmail: lab.email ?? undefined,
    website: lab.website ?? undefined,
    isWhiteLabel: true,
  };
}

async function findLabBrandForClientOrganization(
  clientOrganizationId: string,
): Promise<EmailBrand | undefined> {
  const [customerData] = await getDb()
    .select({ labOrganizationId: schema.customer.labOrganizationId })
    .from(schema.customer)
    .where(eq(schema.customer.authOrganizationId, clientOrganizationId))
    .limit(1);

  if (!customerData?.labOrganizationId) return undefined;

  const [labOrganization] = await getDb()
    .select({
      name: schema.organization.name,
      logo: schema.organization.logo,
      cnpj: schema.organization.cnpj,
      accreditationNumber: schema.organization.accreditationNumber,
      accreditationBody: schema.organization.accreditationBody,
      street: schema.organization.street,
      number: schema.organization.number,
      complement: schema.organization.complement,
      neighbourhood: schema.organization.neighbourhood,
      city: schema.organization.city,
      state: schema.organization.state,
      cep: schema.organization.cep,
      phone: schema.organization.phone,
      email: schema.organization.email,
      website: schema.organization.website,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, customerData.labOrganizationId))
    .limit(1);

  return labOrganization ? createLabEmailBrand(labOrganization) : undefined;
}

async function hasExistingPortalAccess(email: string): Promise<boolean> {
  const [existingPortalMember] = await getDb()
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.member.userId, schema.user.id))
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id),
    )
    .where(
      and(
        eq(schema.user.email, email),
        eq(schema.organization.type, "CLIENT"),
        inArray(schema.member.role, PORTAL_ACCESS_ROLES),
      ),
    )
    .limit(1);

  return Boolean(existingPortalMember);
}

/**
 * Wrap a portal magic-link verify URL in the portal web confirmation page
 * (`/magic-link`). The verify GET is single-use, so an email scanner/prefetcher
 * that fetches the raw link would consume the token before the user clicks; the
 * confirmation page only verifies on a real click. The portal origin is derived
 * from the callbackURL (which carries it — and may be a custom domain). Falls
 * back to the raw verify URL if it can't be rebuilt.
 */
function buildPortalMagicLinkAccessUrl(magicLinkUrl: string): string {
  try {
    const verifyUrl = new URL(magicLinkUrl);
    const token = verifyUrl.searchParams.get("token");
    const callbackURL = verifyUrl.searchParams.get("callbackURL");
    if (!token || !callbackURL) return magicLinkUrl;

    const confirmUrl = new URL("/magic-link", new URL(callbackURL).origin);
    confirmUrl.searchParams.set("token", token);
    confirmUrl.searchParams.set("callbackURL", callbackURL);
    return confirmUrl.toString();
  } catch {
    return magicLinkUrl;
  }
}

async function sendPortalMagicLink(
  data: { email: string; url: string },
  ctx?: unknown,
) {
  const normalizedEmail = data.email.trim().toLowerCase();
  const callbackURL = readCallbackUrlFromMagicLinkContext(ctx);
  const invitationId = readInvitationIdFromCallbackUrl(callbackURL);
  const pendingInvitation = await findPendingPortalInvitation(
    normalizedEmail,
    invitationId,
  );
  const hasPortalAccess =
    Boolean(pendingInvitation) ||
    (await hasExistingPortalAccess(normalizedEmail));

  if (!hasPortalAccess) {
    console.warn(
      `[Portal Auth] Suppressed magic link for non-portal email: ${normalizedEmail}`,
    );
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  const subject = pendingInvitation
    ? sanitizeMailHeader(`Convite para ${pendingInvitation.organizationName}`)
    : "Acesse o Portal CalibraFácil";
  let magicLinkUrl = data.url;

  if (pendingInvitation && !invitationId && callbackURL) {
    try {
      const callbackOrigin = new URL(callbackURL).origin;
      const invitationCallbackURL = `${callbackOrigin}/accept-invite?token=${pendingInvitation.id}`;
      const url = new URL(data.url);
      url.searchParams.set("callbackURL", invitationCallbackURL);
      url.searchParams.set("newUserCallbackURL", invitationCallbackURL);
      magicLinkUrl = url.toString();
    } catch {
      magicLinkUrl = data.url;
    }
  }

  // Route both the normal and invitation magic links through the portal
  // confirmation page so an email scanner/prefetcher can't consume the
  // single-use token before the user clicks. Falls back to the raw verify URL.
  magicLinkUrl = buildPortalMagicLinkAccessUrl(magicLinkUrl);

  const labBrand = pendingInvitation
    ? await findLabBrandForClientOrganization(pendingInvitation.organizationId)
    : undefined;
  const labName = labBrand?.name ?? null;

  if (!apiKey) {
    if (isProductionRuntime()) {
      throw new Error("RESEND_API_KEY is required to send portal magic links");
    }

    console.info(
      `[Better Auth] Portal magic link suppressed in development email delivery for ${normalizedEmail}`,
    );
    return;
  }

  const resend = new Resend(apiKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Calibra Fácil <noreply@calibrafacil.com>";

  await sendResend(resend, {
    from: formatFromEmail(fromEmail, labBrand),
    to: normalizedEmail,
    subject,
    replyTo: getReplyToEmail(labBrand),
    react: pendingInvitation
      ? PortalInvitationEmail({
          recipientName: normalizedEmail,
          organizationName: pendingInvitation.organizationName,
          labName,
          role: pendingInvitation.role ?? undefined,
          inviteUrl: magicLinkUrl,
          logoSrc: getEmailLogoSrc(),
          brand: labBrand,
        })
      : PortalMagicLinkEmail({
          recipientName: normalizedEmail,
          magicLinkUrl,
          logoSrc: getEmailLogoSrc(),
        }),
    text: pendingInvitation
      ? [
          `Convite para ${pendingInvitation.organizationName}`,
          "",
          "Use o link abaixo para aceitar o convite e acessar o portal:",
          magicLinkUrl,
          "",
          "Se você não esperava este convite, ignore esta mensagem.",
        ].join("\n")
      : [
          "Acesse o Portal CalibraFácil",
          "",
          "Use o link abaixo para entrar no portal:",
          magicLinkUrl,
          "",
          "Se você não solicitou acesso, ignore esta mensagem.",
        ].join("\n"),
  });
}

function readSetupTokenFromMagicLinkContext(ctx: unknown): string | undefined {
  if (!ctx || typeof ctx !== "object" || !("body" in ctx)) return undefined;

  const metadata = toRecord(toRecord(toRecord(ctx).body).metadata);
  const setupToken = metadata.setupToken;

  return typeof setupToken === "string" && setupToken.trim()
    ? setupToken.trim()
    : undefined;
}

async function canSendLabPasswordlessEmail(email: string, setupToken?: string) {
  return (
    (await hasValidLabSetupTokenForEmail(setupToken, email)) ||
    (await hasActiveLabMembership(email)) ||
    (await hasPendingLabInvitation(email))
  );
}

/**
 * Point the magic-link email at the web confirmation page (`/magic-link`) instead of
 * Better Auth's single-use `/magic-link/verify` GET. An email scanner or
 * link-preview that prefetches the raw verify URL would consume the one-time
 * token before the user clicks; the confirmation page only verifies on a real
 * click, so sign-in survives prefetching. Falls back to the raw verify URL when
 * the token isn't available or the URL can't be parsed.
 */
function buildLabMagicLinkAccessUrl(data: {
  url: string;
  token?: string;
}): string {
  if (!data.token) return data.url;

  try {
    const verifyUrl = new URL(data.url);
    const callbackURL = verifyUrl.searchParams.get("callbackURL");
    const confirmUrl = new URL(
      "/magic-link",
      resolveWebBaseUrl(isProductionRuntime()),
    );
    confirmUrl.searchParams.set("token", data.token);
    if (callbackURL) {
      confirmUrl.searchParams.set("callbackURL", callbackURL);
    }
    return confirmUrl.toString();
  } catch {
    return data.url;
  }
}

async function sendLabMagicLink(
  data: { email: string; url: string; token?: string },
  ctx?: unknown,
) {
  const normalizedEmail = normalizeLabAccessEmail(data.email);
  const setupToken = readSetupTokenFromMagicLinkContext(ctx);

  if (!(await canSendLabPasswordlessEmail(normalizedEmail, setupToken))) {
    console.warn(
      `[Lab Auth] Suppressed magic link for non-LAB email: ${normalizedEmail}`,
    );
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (isProductionRuntime()) {
      throw new Error("RESEND_API_KEY is required to send LAB magic links");
    }

    console.info(
      `[Better Auth] LAB magic link suppressed in development email delivery for ${normalizedEmail}`,
    );
    return;
  }

  const resend = new Resend(apiKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Calibra Fácil <noreply@calibrafacil.com>";

  const accessUrl = buildLabMagicLinkAccessUrl(data);

  await sendResend(resend, {
    from: fromEmail,
    to: normalizedEmail,
    subject: "Acesse o CalibraFácil",
    react: LabAccessLinkEmail({
      recipientName: normalizedEmail,
      accessUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Acesse o CalibraFácil",
      "",
      "Use o link abaixo para entrar no dashboard:",
      accessUrl,
      "",
      "Se você não solicitou acesso, ignore esta mensagem.",
    ].join("\n"),
  });
}

async function sendLabVerificationOtp(data: {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}) {
  const normalizedEmail = normalizeLabAccessEmail(data.email);

  if (
    data.type !== "sign-in" ||
    !(await canSendLabPasswordlessEmail(normalizedEmail))
  ) {
    console.warn(
      `[Lab Auth] Suppressed ${data.type} OTP for non-LAB email: ${normalizedEmail}`,
    );
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (isProductionRuntime()) {
      throw new Error("RESEND_API_KEY is required to send LAB OTP emails");
    }

    console.info(
      `[Better Auth] LAB OTP suppressed in development email delivery for ${normalizedEmail}`,
    );
    return;
  }

  const resend = new Resend(apiKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Calibra Fácil <noreply@calibrafacil.com>";

  await sendResend(resend, {
    from: fromEmail,
    to: normalizedEmail,
    subject: "Código de acesso ao CalibraFácil",
    react: LabOtpEmail({
      recipientName: normalizedEmail,
      otp: data.otp,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      "Código de acesso ao CalibraFácil",
      "",
      `Seu código de acesso é: ${data.otp}`,
      "",
      "Este código expira em poucos minutos. Se você não solicitou acesso, ignore esta mensagem.",
    ].join("\n"),
  });
}

export async function sendLabAccountSetupEmail(input: {
  email: string;
  recipientName?: string | null;
  organizationName: string;
  claimUrl: string;
}) {
  const normalizedEmail = normalizeLabAccessEmail(input.email);
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    if (isProductionRuntime()) {
      throw new Error("RESEND_API_KEY is required to send LAB setup links");
    }

    console.info(
      `[Better Auth] LAB account setup link suppressed in development email delivery for ${normalizedEmail}`,
    );
    return;
  }

  const resend = new Resend(apiKey);
  const fromEmail =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Calibra Fácil <noreply@calibrafacil.com>";

  await sendResend(resend, {
    from: fromEmail,
    to: normalizedEmail,
    subject: `Configure seu acesso a ${sanitizeMailHeader(input.organizationName)}`,
    react: LabAccessLinkEmail({
      recipientName: input.recipientName ?? normalizedEmail,
      organizationName: input.organizationName,
      accessUrl: input.claimUrl,
      logoSrc: getEmailLogoSrc(),
    }),
    text: [
      `Configure seu acesso a ${input.organizationName}`,
      "",
      "Use o link abaixo para reivindicar seu acesso ao CalibraFácil:",
      input.claimUrl,
      "",
      "Se você não esperava este convite, ignore esta mensagem.",
    ].join("\n"),
  });
}

function labDisplayNameFromEmail(email: string) {
  return (
    email
      .split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim() || email
  );
}

/**
 * Pre-create a user account for an invited LAB email so passwordless sign-in
 * works the moment the invitation is sent.
 *
 * Lab sign-up is disabled on every credential type (emailAndPassword, magicLink
 * and emailOTP all set `disableSignUp: true`), and `acceptInvitation` requires
 * an authenticated session whose email matches the invite. So an invitee who
 * has never signed up would otherwise be unable to authenticate at all — there
 * is no public sign-up route (the product is sales-led). Creating the account
 * up front means magic-link / OTP sign-in just logs them in (the passwordless
 * senders already allow any email with a pending lab invitation), after which
 * they can accept the invitation.
 *
 * Uses the admin `createUser` API, which is a trusted server-side call when
 * invoked without request headers (better-auth only enforces the admin-session
 * check when a request/headers context is present). Idempotent: no-ops when a
 * user with the email already exists, and tolerates a concurrent create.
 */
async function ensureLabInvitationUser(email: string): Promise<void> {
  const normalizedEmail = normalizeLabAccessEmail(email);

  const [existing] = await getDb()
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(sql<string>`lower(${schema.user.email})`, normalizedEmail))
    .limit(1);
  if (existing) return;

  try {
    await getLabAuth().api.createUser({
      body: {
        name: labDisplayNameFromEmail(normalizedEmail),
        email: normalizedEmail,
        password: randomBytes(24).toString("base64url"),
        role: "user",
      },
    });
  } catch (error) {
    // A concurrent invite may have created the user between the check above and
    // this insert; tolerate that, but surface anything else to the caller.
    const [reloaded] = await getDb()
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(sql<string>`lower(${schema.user.email})`, normalizedEmail))
      .limit(1);
    if (!reloaded) throw error;
  }
}

// Organization plugin configuration factory
function createOrganizationPlugin() {
  return organization({
    ac,
    roles,
    defaultMemberRole: "member",
    creatorRole: "owner",
    schema: {
      organization: {
        additionalFields: {
          type: {
            type: "string",
            defaultValue: "LAB",
            input: true,
          },
          // Lab profile fields
          cnpj: { type: "string", input: true },
          accreditationNumber: { type: "string", input: true },
          accreditationBody: { type: "string", input: true },
          accreditationActive: {
            type: "boolean",
            input: true,
            required: false,
            defaultValue: false,
          },
          // Legal-metrology repair authorization (RBMLQ-I oficina permissionária).
          // Optional: existing createOrganization/createUser call sites (backoffice,
          // portal-service-account) must not be forced to pass these.
          permissionariaAuthorizationNumber: {
            type: "string",
            input: true,
            required: false,
          },
          permissionariaAuthorizationState: {
            type: "string",
            input: true,
            required: false,
          },
          street: { type: "string", input: true },
          number: { type: "string", input: true },
          complement: { type: "string", input: true },
          neighbourhood: { type: "string", input: true },
          city: { type: "string", input: true },
          state: { type: "string", input: true },
          cep: { type: "string", input: true },
          phone: { type: "string", input: true },
          email: { type: "string", input: true },
          website: { type: "string", input: true },
          technicalManagerName: { type: "string", input: true },
          technicalManagerTitle: { type: "string", input: true },
        },
      },
    },
    organizationHooks: {
      beforeCreateOrganization: async ({ organization, user }) => {
        const requestedType = organization.type ?? "LAB";

        // 3B guardrail: CLIENT organizations are system-owned.
        // They must be created through server-side flows using the
        // configured service account (PORTAL_SERVICE_USER_ID).
        if (requestedType === "CLIENT") {
          const serviceUserId = process.env.PORTAL_SERVICE_USER_ID?.trim();

          if (!serviceUserId) {
            throw new APIError("BAD_REQUEST", {
              message: "PORTAL_SERVICE_USER_ID não configurado",
            });
          }

          if (!user || user.id !== serviceUserId) {
            throw new APIError("FORBIDDEN", {
              message:
                "CLIENT organizations must be provisioned by the portal service account",
            });
          }
        }
      },
      // DOM-07: enforce the plan's `users` limit on BOTH provisioning paths —
      // sending an invitation and directly adding a member. Throws a 402
      // LIMIT_EXCEEDED (assertOrganizationUserLimit) when the org is at/over its
      // limit. LAB-only; CLIENT (portal) orgs are exempt (see helper). Pending
      // invitations count as provisioned seats, so acceptance never exceeds the
      // limit (accept-invitation adds the member directly and does not run
      // beforeAddMember, so there is no double count).
      beforeCreateInvitation: async ({ invitation }) => {
        await assertOrganizationUserLimit(invitation.organizationId);
      },
      beforeAddMember: async ({ member }) => {
        await assertOrganizationUserLimit(member.organizationId);
      },
    },
    async sendInvitationEmail(data) {
      // Pre-create the invited account for LAB organizations so the invitee can
      // authenticate via magic-link / OTP (see ensureLabInvitationUser).
      // Best-effort: a failure here must never block delivery of the invitation
      // email, which still drives the manual access-setup fallback.
      try {
        const [org] = await getDb()
          .select({ type: schema.organization.type })
          .from(schema.organization)
          .where(eq(schema.organization.id, data.organization.id))
          .limit(1);
        if (org?.type === "LAB") {
          await ensureLabInvitationUser(data.email);
        }
      } catch (error) {
        console.error(
          "[Lab Auth] Failed to pre-create invited user; sending invitation email anyway",
          error,
        );
      }

      const appUrl = process.env.APP_URL || "http://localhost:5173";
      const inviteLink = `${appUrl}/accept-invitation/${data.id}`;
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new Error("RESEND_API_KEY is not configured");
      }
      const resend = new Resend(apiKey);
      const fromEmail =
        process.env.RESEND_FROM_EMAIL ||
        process.env.EMAIL_FROM ||
        "Calibra Fácil <noreply@calibrafacil.com>";

      await sendResend(resend, {
        from: fromEmail,
        to: data.email,
        subject: `Convite para ${data.organization.name}`,
        react: OrganizationInvitationEmail({
          invitedByUsername: data.inviter.user.name,
          invitedByEmail: data.inviter.user.email,
          organizationName: data.organization.name,
          inviteLink,
          role: data.role,
          logoSrc: getEmailLogoSrc(),
        }),
      });
    },
  });
}

// Shared configuration factory - reads env at call time, not module load time
function createSharedConfig(surface: AuthSurface) {
  const isProduction = isProductionRuntime();
  const configuredApiUrl = readEnv("API_URL");
  const crossSubDomainCookieDomain =
    getCookieDomainFromApiUrl(configuredApiUrl);
  // Enable cross-sub-domain cookies whenever the API host is on the
  // .calibrafacil.com zone. In dev, this lets the lab_session / portal_session
  // cookies be shared across dev-web and dev-portal tunnels; in prod, it
  // preserves the existing api.calibrafacil.com → frontends behavior.
  // shouldUseCrossSubDomainCookies adds an extra https/protocol guard so that
  // plaintext .calibrafacil.com hosts cannot opt in by accident.
  const useCrossSubDomainCookies = shouldUseCrossSubDomainCookies(
    isProduction,
    configuredApiUrl,
    crossSubDomainCookieDomain,
  );
  const useSecureCookies =
    isProduction || configuredApiUrl?.startsWith("https://") === true;
  const authSecret = resolveAuthSecret(isProduction);
  const defaultSameSite: "lax" | "none" = useCrossSubDomainCookies
    ? "none"
    : "lax";

  return {
    secret: authSecret,
    database: drizzleAdapter(getDb(), {
      provider: "pg" as const,
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({
        user,
        url,
      }: {
        user: { email: string };
        url: string;
      }) => {
        const apiKey = process.env.RESEND_API_KEY;

        if (!apiKey) {
          if (isProduction) {
            throw new Error("RESEND_API_KEY is required to send reset emails");
          }

          console.info(
            `[Better Auth] Reset password link suppressed in development email delivery for ${user.email}`,
          );
          return;
        }

        const resend = new Resend(apiKey);
        const fromEmail =
          process.env.RESEND_FROM_EMAIL ||
          process.env.EMAIL_FROM ||
          "Calibra Fácil <noreply@calibrafacil.com>";

        await sendResend(resend, {
          from: fromEmail,
          to: user.email,
          subject: "Defina sua senha no CalibraFácil",
          react: PasswordResetEmail({
            recipientName: user.email,
            resetUrl: url,
            logoSrc: getEmailLogoSrc(),
          }),
          text: [
            "Defina sua senha no CalibraFácil",
            "",
            "Use o link abaixo para definir ou redefinir sua senha:",
            url,
            "",
            "Se você não esperava este email, ignore esta mensagem.",
          ].join("\n"),
        });
      },
      resetPasswordTokenExpiresIn: 60 * 60,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({
        user,
        url,
      }: {
        user: { email: string; name?: string | null };
        url: string;
        token: string;
      }) => {
        const verificationUrl = resolveEmailVerificationUrl(
          url,
          resolveWebBaseUrl(isProduction),
        );
        const apiKey = process.env.RESEND_API_KEY;

        if (!apiKey) {
          if (isProduction) {
            throw new Error(
              "RESEND_API_KEY is required to send verification emails",
            );
          }

          console.info(
            `[Better Auth] Email verification link for ${user.email}: ${verificationUrl}`,
          );
          return;
        }

        const resend = new Resend(apiKey);
        const fromEmail =
          process.env.RESEND_FROM_EMAIL ||
          process.env.EMAIL_FROM ||
          "Calibra Fácil <noreply@calibrafacil.com>";

        await sendResend(resend, {
          from: fromEmail,
          to: user.email,
          subject: "Confirme seu e-mail no CalibraFácil",
          react: EmailConfirmationEmail({
            recipientName: user.name ?? user.email,
            confirmationUrl: verificationUrl,
            logoSrc: getEmailLogoSrc(),
          }),
          text: [
            "Confirme seu e-mail no CalibraFácil",
            "",
            "Use o link abaixo para confirmar seu endereço de e-mail:",
            verificationUrl,
            "",
            "Se você não criou uma conta, ignore esta mensagem.",
          ].join("\n"),
        });
      },
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    trustedOrigins: createTrustedOrigins(isProduction, surface),
    session: {
      // Serve the session from a signed, short-lived cookie so routine
      // get-session checks resolve without a Postgres read on every
      // authenticated request. Trade-off: a revoked or role-changed session can
      // remain valid on a given device for up to maxAge; mutations (sign-in,
      // organization.setActive, session revoke) refresh the cookie immediately.
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5, // 5 minutes (lab + portal; backoffice overrides shorter)
      },
      // Explicit lifetimes (previously implicit Better Auth defaults) for the
      // regulated context. expiresIn = absolute lifetime; updateAge = how often
      // a live session slides its expiry on use.
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    advanced: {
      crossSubDomainCookies: useCrossSubDomainCookies
        ? {
            enabled: true,
            domain: crossSubDomainCookieDomain ?? ".calibrafacil.com",
          }
        : { enabled: false },
      defaultCookieAttributes: {
        sameSite: defaultSameSite,
        secure: useSecureCookies,
      },
    },
  };
}

type CreatedAuthSessionRecord = {
  id?: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  impersonatedBy?: string | null;
};

/**
 * Append a sign-in entry to the platform event log. Session creation is the
 * one auth transition the audit trail previously missed (setup-token claims
 * and impersonation were already logged). Failures are swallowed: an audit
 * write must never block a sign-in.
 */
async function logAuthSessionCreated(
  surface: AuthSurface,
  session: CreatedAuthSessionRecord,
) {
  try {
    await getDb()
      .insert(schema.platformEventLog)
      .values({
        actorUserId: session.impersonatedBy ?? session.userId,
        targetUserId: session.userId,
        action: "auth.session_created",
        entityType: "auth_session",
        entityId: session.id ?? null,
        details: {
          surface,
          ...(session.ipAddress ? { ipAddress: session.ipAddress } : {}),
          ...(session.userAgent ? { userAgent: session.userAgent } : {}),
          ...(session.impersonatedBy
            ? { impersonatedBy: session.impersonatedBy }
            : {}),
        },
      });
  } catch (error) {
    console.error(
      `[Auth Audit] Failed to log ${surface} session creation`,
      error,
    );
  }
}

async function findDefaultActiveOrganizationId(
  userId: string,
  organizationType: "CLIENT" | "LAB",
): Promise<string | null> {
  const [membership] = await getDb()
    .select({
      organizationId: schema.member.organizationId,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.member.organizationId, schema.organization.id),
    )
    .where(
      and(
        eq(schema.member.userId, userId),
        eq(schema.organization.type, organizationType),
      ),
    )
    .orderBy(asc(schema.member.createdAt))
    .limit(1);

  return membership?.organizationId ?? null;
}

// Web origins where the LAB UI is actually served. These are the only origins a
// LAB passkey ceremony may run from; portal/ops/api hosts and the Electron
// `app://` scheme are intentionally excluded (the LAB UI is not served there and
// custom schemes are not valid WebAuthn origins). Mirrors the web entries in
// PROD_TRUSTED_ORIGINS / DEV_TRUSTED_ORIGINS.
const PROD_LAB_WEB_ORIGINS = [
  "https://calibrafacil.com",
  "https://www.calibrafacil.com",
];

const DEV_LAB_WEB_ORIGINS = [
  "https://dev-web.calibrafacil.com",
  "http://localhost:5173",
  "https://localhost:5173",
  "http://192.168.0.10:5173",
  "https://192.168.0.10:5173",
];

// The relying-party ID must be a registrable domain so a single credential works
// across the apex and every subdomain (calibrafacil.com + www). Returning
// url.hostname (e.g. "www.calibrafacil.com") would scope the credential to that
// exact host and break the apex, and vice-versa. localhost / LAN IPs keep their
// own host. `PASSKEY_RP_ID` lets ops pin it explicitly if ever needed.
function resolveLabPasskeyRpId(hostname: string): string {
  const explicit = readEnv("PASSKEY_RP_ID");
  if (explicit) return explicit;

  const normalized = hostname.toLowerCase();
  if (
    normalized === "calibrafacil.com" ||
    normalized.endsWith(".calibrafacil.com")
  ) {
    return "calibrafacil.com";
  }

  return normalized;
}

function resolveLabPasskeyOrigins(
  isProduction: boolean,
  primaryOrigin: string,
): string[] {
  const base = isProduction ? PROD_LAB_WEB_ORIGINS : DEV_LAB_WEB_ORIGINS;
  return [...new Set([primaryOrigin, ...base])];
}

function createLabPasskeyPluginOptions(isProduction: boolean) {
  const webBaseUrl = resolveWebBaseUrl(isProduction);

  try {
    const url = new URL(webBaseUrl);

    return {
      rpName: "CalibraFácil",
      rpID: resolveLabPasskeyRpId(url.hostname),
      origin: resolveLabPasskeyOrigins(isProduction, url.origin),
      // Leave authenticatorAttachment unset so platform authenticators
      // (Apple/Google/Windows) AND password managers (1Password, Bitwarden) and
      // cross-platform keys can all register. residentKey:"preferred" yields a
      // discoverable credential (required for conditional-UI autofill on sign-in).
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      advanced: {
        webAuthnChallengeCookie: "lab-passkey-challenge",
      },
      registration: {
        requireSession: false,
        resolveUser: async ({ context }: { context?: string | null }) => {
          const token = context?.trim();

          if (!token) {
            throw new APIError("BAD_REQUEST", {
              message: "Token de configuração obrigatório",
            });
          }

          const validation = await validateLabAccountSetupToken(token);

          if (!validation.ok) {
            throw new APIError("BAD_REQUEST", {
              message: "Link de configuração inválido ou expirado",
            });
          }

          return {
            id: validation.token.userId,
            name: validation.token.email,
            displayName: validation.token.email,
          };
        },
        afterVerification: async ({
          user,
          context,
        }: {
          user: { id: string };
          context?: string | null;
        }) => {
          const token = context?.trim();
          const validation = token
            ? await validateLabAccountSetupToken(token)
            : null;

          if (token && !validation?.ok) {
            throw new APIError("BAD_REQUEST", {
              message: "Link de configuração inválido ou expirado",
            });
          }

          if (validation?.ok) {
            if (validation.token.userId !== user.id) {
              throw new APIError("FORBIDDEN", {
                message: "Link de configuração não pertence a este usuário",
              });
            }
          }

          await getDb()
            .insert(schema.platformEventLog)
            .values({
              actorUserId: user.id,
              targetUserId: user.id,
              action: "lab_account.passkey_registered",
              entityType: "lab_account_setup_token",
              entityId: validation?.ok ? validation.token.id : null,
              details: validation?.ok
                ? {
                    organizationId: validation.token.organizationId,
                    invitationId: validation.token.invitationId,
                    purpose: validation.token.purpose,
                  }
                : null,
            });
        },
      },
    } satisfies Parameters<typeof passkey>[0];
  } catch {
    return {
      rpName: "CalibraFácil",
      advanced: {
        webAuthnChallengeCookie: "lab-passkey-challenge",
      },
      registration: {
        requireSession: false,
        resolveUser: async () => {
          throw new APIError("BAD_REQUEST", {
            message: "Origem WebAuthn não configurada",
          });
        },
      },
    } satisfies Parameters<typeof passkey>[0];
  }
}

/**
 * Factory function to create Lab Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createLabAuth() {
  const sharedConfig = createSharedConfig("lab");
  const isProduction = isProductionRuntime();
  const baseURL = createBaseUrlConfig(isProduction);

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/lab",
    baseURL,
    emailAndPassword: {
      ...sharedConfig.emailAndPassword,
      disableSignUp: true,
    },
    databaseHooks: {
      session: {
        create: {
          async before(session: {
            activeOrganizationId?: string | null;
            userId: string;
          }) {
            if (session.activeOrganizationId) {
              return;
            }

            const activeOrganizationId = await findDefaultActiveOrganizationId(
              session.userId,
              "LAB",
            );

            if (!activeOrganizationId) {
              return;
            }

            return {
              data: {
                activeOrganizationId,
              },
            };
          },
          async after(session: CreatedAuthSessionRecord) {
            await logAuthSessionCreated("lab", session);
          },
        },
      },
    },
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "lab",
    },
    plugins: [
      passkey(createLabPasskeyPluginOptions(isProduction)),
      magicLink({
        expiresIn: 60 * 10,
        sendMagicLink: sendLabMagicLink,
        disableSignUp: true,
        storeToken: "hashed",
        rateLimit: {
          window: 60,
          max: 5,
        },
      }),
      emailOTP({
        expiresIn: 60 * 10,
        disableSignUp: true,
        storeOTP: "hashed",
        rateLimit: {
          window: 60,
          max: 5,
        },
        sendVerificationOTP: sendLabVerificationOtp,
      }),
      adminPlugin({
        ac: platformAc,
        roles: platformRoles,
        defaultRole: "user",
      }),
      oneTimeToken({
        disableClientRequest: true,
        expiresIn: IMPERSONATION_HANDOFF_TOKEN_EXPIRES_IN_SECONDS,
        storeToken: "hashed",
      }),
      createOrganizationPlugin(),
      sso({
        providersLimit: 1,
        disableImplicitSignUp: true,
        organizationProvisioning: {
          disabled: true,
        },
        domainVerification: {
          enabled: true,
        },
      }),
    ],
  });
}

/**
 * Factory function to create Backoffice Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createBackofficeAuth() {
  const sharedConfig = createSharedConfig("backoffice");
  const isProduction = isProductionRuntime();
  const baseURL = createBaseUrlConfig(isProduction);

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/backoffice",
    baseURL,
    // Tighter than lab/portal for the privileged operations surface: a short
    // cookie-cache window bounds how long a revoked operator session stays live,
    // and a 1-day absolute lifetime forces a daily re-login (2FA "trust device"
    // still suppresses repeated TOTP prompts within its own window).
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 60, // 1 minute
      },
      expiresIn: 60 * 60 * 24, // 1 day
      updateAge: 60 * 60 * 24, // 1 day
    },
    emailAndPassword: {
      ...sharedConfig.emailAndPassword,
      disableSignUp: true,
    },
    databaseHooks: {
      session: {
        create: {
          async after(session: CreatedAuthSessionRecord) {
            await logAuthSessionCreated("backoffice", session);
          },
        },
      },
    },
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "backoffice",
    },
    plugins: [
      // Two-factor is mandatory for the internal operations surface. Enrollment
      // is enforced client-side (apps/backoffice forces TOTP setup before any
      // page loads); the plugin only intercepts sign-in once a user is enrolled.
      // TOTP authenticator app + encrypted backup codes only — no email OTP.
      twoFactor({
        issuer: "CalibraFácil Ops",
        backupCodeOptions: {
          // Better Auth stores backup codes as plain JSON unless told
          // otherwise (the TOTP secret is always encrypted). Encrypt them at
          // rest under the auth secret so a database leak doesn't yield
          // working 2FA bypass codes. Rows enrolled before this option must
          // be re-encrypted (packages/auth/scripts/encrypt-two-factor-backup-codes.ts)
          // or regenerated. Note: rotating BETTER_AUTH_SECRET invalidates them.
          storeBackupCodes: "encrypted",
        },
      }),
      adminPlugin({
        ac: platformAc,
        roles: platformRoles,
        defaultRole: "user",
      }),
      oneTimeToken({
        disableClientRequest: true,
        expiresIn: IMPERSONATION_HANDOFF_TOKEN_EXPIRES_IN_SECONDS,
        storeToken: "hashed",
      }),
    ],
  });
}

/**
 * Factory function to create Portal Auth instance
 * Call this inside request handlers to ensure env vars are available
 */
export function createPortalAuth() {
  const sharedConfig = createSharedConfig("portal");
  const isProduction = isProductionRuntime();
  const baseURL = createBaseUrlConfig(isProduction);

  return betterAuth({
    ...sharedConfig,
    basePath: "/api/auth/portal",
    baseURL,
    emailAndPassword: {
      enabled: false,
    },
    databaseHooks: {
      session: {
        create: {
          async before(session: {
            activeOrganizationId?: string | null;
            userId: string;
          }) {
            if (session.activeOrganizationId) {
              return;
            }

            const activeOrganizationId = await findDefaultActiveOrganizationId(
              session.userId,
              "CLIENT",
            );

            if (!activeOrganizationId) {
              return;
            }

            return {
              data: {
                activeOrganizationId,
              },
            };
          },
          async after(session: CreatedAuthSessionRecord) {
            await logAuthSessionCreated("portal", session);
          },
        },
      },
    },
    advanced: {
      ...sharedConfig.advanced,
      cookiePrefix: "portal",
    },
    plugins: [
      magicLink({
        expiresIn: 60 * 10,
        sendMagicLink: sendPortalMagicLink,
        storeToken: "hashed",
        rateLimit: {
          window: 60,
          max: 5,
        },
      }),
      createOrganizationPlugin(),
    ],
  });
}

// For backwards compatibility in non-Worker environments (like local dev with Bun)
// These are lazily initialized on first use
let _labAuth: ReturnType<typeof createLabAuth> | null = null;
let _backofficeAuth: ReturnType<typeof createBackofficeAuth> | null = null;
let _portalAuth: ReturnType<typeof createPortalAuth> | null = null;

export function getLabAuth() {
  if (!_labAuth) {
    _labAuth = createLabAuth();
  }
  return _labAuth;
}

export function getBackofficeAuth() {
  if (!_backofficeAuth) {
    _backofficeAuth = createBackofficeAuth();
  }
  return _backofficeAuth;
}

export function getPortalAuth() {
  if (!_portalAuth) {
    _portalAuth = createPortalAuth();
  }
  return _portalAuth;
}

// Type definitions for auth instances with organization plugin
export type LabAuth = ReturnType<typeof createLabAuth>;
export type BackofficeAuth = ReturnType<typeof createBackofficeAuth>;
export type PortalAuth = ReturnType<typeof createPortalAuth>;

// Legacy exports for backwards compatibility (lazy getters)
export const labAuth: Pick<LabAuth, "api" | "handler"> = {
  get api() {
    return getLabAuth().api;
  },
  get handler() {
    return getLabAuth().handler;
  },
};

export const backofficeAuth: Pick<BackofficeAuth, "api" | "handler"> = {
  get api() {
    return getBackofficeAuth().api;
  },
  get handler() {
    return getBackofficeAuth().handler;
  },
};

export const portalAuth: Pick<PortalAuth, "api" | "handler"> = {
  get api() {
    return getPortalAuth().api;
  },
  get handler() {
    return getPortalAuth().handler;
  },
};

export const auth = labAuth;

export type Auth = LabAuth;
export type Session = Auth["$Infer"]["Session"];
