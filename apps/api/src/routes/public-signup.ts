import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import {
  buildLabClaimUrl,
  createLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { sendLabAccountSetupEmail } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  member,
  operatorAlert,
  organization,
  platformEventLog,
} from "@calibra-facil/db/schema";
import { SelfServeSignupSchema } from "@calibra-facil/schemas";
import {
  checkSignupEmail,
  SIGNUP_EMAIL_REJECTION_MESSAGES,
} from "@calibra-facil/shared";

import { checkDomainHasMx } from "../lib/email-domain-mx";
import {
  findLabProvisioningUser,
  provisionLabAccount,
} from "../services/lab-provisioning";
import { appBaseUrl } from "@calibra-facil/shared/public-urls";

/**
 * Public, UNAUTHENTICATED self-serve sign-up for a laboratory.
 *
 * This is the only route in the product that creates an organization without a
 * human on our side approving it, so the gate is deliberately layered:
 *
 * 1. `PUBLIC_SIGNUP_ENABLED` — off by default. Opening public sign-up is a
 *    posture change (the product was invite-only), so it takes an explicit
 *    operator decision per environment, not a deploy.
 * 2. The e-mail must be at the laboratory's own domain (`checkSignupEmail`).
 * 3. That domain must publish MX records — a domain that cannot receive mail
 *    cannot receive the claim link either.
 * 4. A honeypot field, answered with a success shape so bots learn nothing.
 * 5. A per-domain cap, so one domain cannot mint organizations in a loop.
 *
 * No session is ever minted here. Provisioning creates the account and mails a
 * claim link; the visitor still has to prove they read that mailbox, which is
 * the same handshake the invite flow uses.
 */

/** Self-serve organizations allowed per e-mail domain, per rolling day. */
const DOMAIN_SIGNUP_CAP = 3;
const DOMAIN_SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000;

const SIGNUP_EVENT_ACTION = "public.signup.provisioned";

function envValue(c: { env?: unknown }, key: string): string | undefined {
  const runtimeEnv =
    c.env && typeof c.env === "object"
      ? Object.fromEntries(Object.entries(c.env))
      : {};
  const fromRuntime = runtimeEnv[key];
  const value =
    typeof fromRuntime === "string" ? fromRuntime : process.env[key];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function publicSignupEnabled(c: { env?: unknown }) {
  return envValue(c, "PUBLIC_SIGNUP_ENABLED")?.toLowerCase() === "true";
}

/**
 * The claim link carries the account-setup secret, and this endpoint is
 * unauthenticated: anyone can submit a stranger's corporate address. Reading
 * the host from `Origin` or `Referer` would let the caller choose where that
 * secret is sent, and a non-browser client sets those headers freely regardless
 * of CORS. Only configuration decides. Same resolution the lab-setup and
 * invitation flows use.
 */
function resolveTrustedAppUrl(c: { env?: unknown }) {
  const configured = envValue(c, "APP_URL") ?? envValue(c, "WEB_URL");
  if (configured) return configured.replace(/\/+$/, "");

  return appBaseUrl();
}

/**
 * True when this e-mail already belongs to a laboratory team.
 *
 * Scoped to LAB organizations on purpose: `member` also holds the memberships
 * of the system-owned CLIENT organizations behind the customer portal. Someone
 * whose supplier gave them a portal login has no laboratory of their own, and
 * counting that as an existing account would refuse them their own sign-up.
 * `organization.type` is nullable on rows that predate the column, and those
 * are all laboratories.
 */
async function hasExistingLabMembership(email: string) {
  const existing = await findLabProvisioningUser(email);
  if (!existing) return false;

  const memberships = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(
      and(
        eq(member.userId, existing.id),
        or(eq(organization.type, "LAB"), isNull(organization.type)),
      ),
    )
    .limit(1);

  return memberships.length > 0;
}

/**
 * Take one of the domain's daily slots, or return null when they are gone.
 *
 * Counting and then provisioning would be a check followed much later by a
 * write, and a burst of parallel requests for the same domain all read a count
 * below the cap before any of them writes — which is exactly how someone would
 * defeat it. The advisory lock serializes every signup for one domain, and the
 * slot is claimed as a row before provisioning starts, so a concurrent request
 * counts it.
 *
 * The row is the audit entry itself, completed once the organization exists and
 * deleted if provisioning fails: an abandoned attempt should not spend a slot.
 */
async function reserveSignupSlot(domain: string, emailKey: string) {
  return db.transaction(async (tx) => {
    // Two locks, both transaction-scoped so they live on this transaction's own
    // connection and cannot be stranded by pooling. The domain lock caps abuse;
    // the e-mail lock makes the "already registered" check and the reservation
    // that follows it one atomic step, so two concurrent posts for the same new
    // address cannot both pass and leave one person owning two laboratories.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`public-signup:${domain}`}))`,
    );
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`public-signup-email:${emailKey}`}))`,
    );

    const since = new Date(Date.now() - DOMAIN_SIGNUP_WINDOW_MS);

    // A reservation already in flight for this exact address is a duplicate
    // submit, not a second laboratory.
    const [inFlight] = await tx
      .select({ id: platformEventLog.id })
      .from(platformEventLog)
      .where(
        and(
          eq(platformEventLog.action, SIGNUP_EVENT_ACTION),
          gte(platformEventLog.createdAt, since),
          sql`${platformEventLog.details} ->> 'emailKey' = ${emailKey}`,
        ),
      )
      .limit(1);

    if (inFlight) return "duplicate" as const;

    const rows = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(platformEventLog)
      .where(
        and(
          eq(platformEventLog.action, SIGNUP_EVENT_ACTION),
          gte(platformEventLog.createdAt, since),
          sql`${platformEventLog.details} ->> 'emailDomain' = ${domain}`,
        ),
      );

    if ((rows[0]?.total ?? 0) >= DOMAIN_SIGNUP_CAP)
      return "domain_cap" as const;

    const [reserved] = await tx
      .insert(platformEventLog)
      .values({
        action: SIGNUP_EVENT_ACTION,
        entityType: "organization",
        details: { emailDomain: domain, emailKey, status: "RESERVED" },
      })
      .returning();

    return reserved?.id ?? null;
  });
}

async function releaseSignupSlot(reservationId: number) {
  try {
    await db
      .delete(platformEventLog)
      .where(eq(platformEventLog.id, reservationId));
  } catch (error) {
    console.error("Failed to release a public signup reservation", error);
  }
}

export const publicSignupRouter = new Hono()
  .use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store, max-age=0");
    c.header("X-Robots-Tag", "noindex, nofollow");
  })
  .post("/", zValidator("json", SelfServeSignupSchema), async (c) => {
    if (!publicSignupEnabled(c)) {
      return c.json(
        {
          error:
            "O cadastro automático está indisponível. Fale com a nossa equipe.",
        },
        404,
      );
    }

    const input = c.req.valid("json");

    // Honeypot: answer exactly like a success so a bot cannot tell it failed.
    if (input.website.trim().length > 0) {
      return c.json({ ok: true });
    }

    const emailCheck = checkSignupEmail(input.email);
    if (!emailCheck.ok) {
      return c.json(
        { error: SIGNUP_EMAIL_REJECTION_MESSAGES[emailCheck.reason] },
        422,
      );
    }

    const mx = await checkDomainHasMx(emailCheck.domain);
    if (mx === "no_mx") {
      return c.json(
        {
          error: `O domínio ${emailCheck.domain} não recebe e-mails, então não conseguiríamos enviar o seu acesso. Confira o endereço.`,
        },
        422,
      );
    }

    {
      if (await hasExistingLabMembership(emailCheck.email)) {
        return c.json(
          {
            error:
              "Este e-mail já faz parte de um laboratório no CalibraFácil. Entre pela página de acesso.",
            code: "ALREADY_REGISTERED",
          },
          409,
        );
      }

      const reservation = await reserveSignupSlot(
        emailCheck.domain,
        emailCheck.email,
      );

      if (reservation === "duplicate") {
        return c.json(
          {
            error:
              "Já existe um cadastro em andamento para este e-mail. Confira a sua caixa de entrada em alguns instantes.",
          },
          409,
        );
      }

      if (reservation === "domain_cap") {
        return c.json(
          {
            error:
              "Já foram abertas contas demais para este domínio hoje. Fale com a nossa equipe para continuar.",
          },
          429,
        );
      }

      if (reservation === null) {
        return c.json(
          { error: "Não foi possível iniciar o cadastro. Tente novamente." },
          500,
        );
      }

      const reservationId = reservation;

      try {
        // The account starts on FREE: paying is what promotes it, and the checkout
        // webhook is the only thing that writes an ACTIVE plan. Provisioning on the
        // chosen plan would hand out a paid tier for free, since a TRIAL
        // subscription never expires today.
        const provisioned = await provisionLabAccount({
          lab: {
            name: input.labName,
            cnpj: input.cnpj,
            phone: input.phone,
            email: emailCheck.email,
          },
          owner: { name: input.name, email: emailCheck.email },
          planId: "FREE",
        });

        // Completed before the e-mail goes out: from here the organization
        // exists, so the audit trail must say so even if delivery fails.
        await completeSignupReservation({
          reservationId,
          ownerUserId: provisioned.owner.id,
          organizationId: provisioned.organization.id,
          emailDomain: emailCheck.domain,
          planId: input.planId,
          billingCycle: input.billingCycle,
          mx,
        });

        try {
          await sendClaimEmail({
            appUrl: resolveTrustedAppUrl(c),
            owner: provisioned.owner,
            organizationId: provisioned.organization.id,
            organizationName: provisioned.organization.name,
            planId: input.planId,
            billingCycle: input.billingCycle,
          });
        } catch (error) {
          // The organization is already committed, so this is not a failed
          // sign-up — it is a delivered account whose link did not arrive. Saying
          // "try again" would be a lie: the retry finds the account and refuses
          // it. Tell the truth and put it in front of an operator.
          console.error("Failed to send the self-serve claim e-mail", error);
          await raiseUndeliveredClaimAlert({
            email: provisioned.owner.email,
            organizationId: provisioned.organization.id,
            organizationName: provisioned.organization.name,
          });

          return c.json(
            {
              ok: true,
              email: provisioned.owner.email,
              emailDelivered: false,
              error:
                "A conta do seu laboratório foi criada, mas não conseguimos enviar o e-mail de acesso agora. Nossa equipe reenvia o link para você.",
              code: "SETUP_EMAIL_FAILED",
            },
            202,
          );
        }

        return c.json({ ok: true, email: provisioned.owner.email });
      } catch (error) {
        await releaseSignupSlot(reservationId);
        throw error;
      }
    }
  });

/**
 * Put an undelivered claim link in front of a human.
 *
 * There is no public "resend my link" endpoint, and there should not be one:
 * unauthenticated, it would mail anyone's inbox on demand. So the recovery path
 * is an operator, and this is what tells them there is someone to recover.
 */
async function raiseUndeliveredClaimAlert(params: {
  email: string;
  organizationId: string;
  organizationName: string;
}) {
  try {
    const now = new Date();
    await db
      .insert(operatorAlert)
      .values({
        organizationId: params.organizationId,
        dedupeKey: `signup:claim_email_failed:${params.organizationId}`,
        kind: "public_signup_claim_email_failed",
        severity: "warning",
        title: "Cadastro self-serve sem e-mail de acesso",
        detail: `A conta de ${params.organizationName} foi criada pelo cadastro público, mas o e-mail com o link de acesso para ${params.email} não pôde ser enviado. Reenvie o convite pelo backoffice.`,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: operatorAlert.dedupeKey,
        set: { lastSeenAt: now, updatedAt: now },
      });
  } catch (error) {
    console.error("Failed to record an undelivered claim e-mail", error);
  }
}

/**
 * Mint the claim token and mail it.
 *
 * Kept separate from provisioning because the two fail differently. The
 * organization is committed by the time this runs, so a Resend outage is not a
 * failed sign-up: the account is real and only the link is missing. Retrying
 * the same address would find that account and refuse it, which is why the
 * caller reports delivery separately instead of raising.
 */
async function sendClaimEmail(params: {
  appUrl: string;
  owner: { id: string; name: string; email: string };
  organizationId: string;
  organizationName: string;
  planId: string;
  billingCycle: string;
}) {
  const setupToken = await createLabAccountSetupToken({
    userId: params.owner.id,
    organizationId: params.organizationId,
    email: params.owner.email,
    purpose: "owner_claim",
    source: "public.self_serve_signup",
  });

  const claimUrl = new URL(buildLabClaimUrl(params.appUrl, setupToken.token));
  // Carried through the claim so the plan chosen on the pricing page is still
  // selected when the owner lands on billing.
  claimUrl.searchParams.set("plano", params.planId);
  claimUrl.searchParams.set("ciclo", params.billingCycle);

  await sendLabAccountSetupEmail({
    email: params.owner.email,
    recipientName: params.owner.name,
    organizationName: params.organizationName,
    claimUrl: claimUrl.toString(),
  });
}

/**
 * Turn the reserved slot into the audit record of what was provisioned.
 *
 * `actorUserId` stays null: nobody was authenticated here. Anyone can submit
 * somebody else's address, so naming the new owner as the actor would put a
 * claim in the trail that the person acted, before they have proved they can
 * even read that mailbox. They are the target, not the author — the same shape
 * the unauthenticated invitation and setup events use.
 */
async function completeSignupReservation(params: {
  reservationId: number;
  ownerUserId: string;
  organizationId: string;
  emailDomain: string;
  planId: string;
  billingCycle: string;
  mx: string;
}) {
  await db
    .update(platformEventLog)
    .set({
      actorUserId: null,
      targetUserId: params.ownerUserId,
      entityId: params.organizationId,
      details: {
        emailDomain: params.emailDomain,
        intendedPlanId: params.planId,
        intendedBillingCycle: params.billingCycle,
        mxCheck: params.mx,
      },
    })
    .where(eq(platformEventLog.id, params.reservationId));
}
