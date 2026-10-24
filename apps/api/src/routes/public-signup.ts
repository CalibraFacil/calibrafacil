import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  buildLabClaimUrl,
  createLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { sendLabAccountSetupEmail } from "@calibra-facil/auth";
import { SelfServeSignupSchema } from "@calibra-facil/schemas";
import {
  checkSignupEmail,
  SIGNUP_EMAIL_REJECTION_MESSAGES,
} from "@calibra-facil/shared";

import { checkDomainHasMx } from "../lib/email-domain-mx";
import {
  completeSignupReservation,
  hasLabMembership,
  releaseSignupSlot,
  reserveSignupSlot,
} from "../lib/public-signup-store";
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

/** True when this e-mail already belongs to a laboratory team (see `hasLabMembership`). */
async function hasExistingLabMembership(email: string) {
  const existing = await findLabProvisioningUser(email);
  if (!existing) return false;

  return hasLabMembership(existing.id);
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
        const provisioned = await provisionLabAccount({
          lab: {
            name: input.labName,
            cnpj: input.cnpj,
            phone: input.phone,
            email: emailCheck.email,
          },
          owner: { name: input.name, email: emailCheck.email },
        });

        // Completed before the e-mail goes out: from here the organization
        // exists, so the audit trail must say so even if delivery fails.
        await completeSignupReservation({
          reservationId,
          ownerUserId: provisioned.owner.id,
          organizationId: provisioned.organization.id,
          emailDomain: emailCheck.domain,
          mx,
        });

        try {
          await sendClaimEmail({
            appUrl: resolveTrustedAppUrl(c),
            owner: provisioned.owner,
            organizationId: provisioned.organization.id,
            organizationName: provisioned.organization.name,
          });
        } catch (error) {
          // The organization is already committed, so this is not a failed
          // sign-up — it is a delivered account whose link did not arrive. Saying
          // "try again" would be a lie: the retry finds the account and refuses
          // it. Tell the truth and log it for the instance operator.
          console.error("Failed to send the self-serve claim e-mail", {
            email: provisioned.owner.email,
            organizationId: provisioned.organization.id,
            error,
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
}) {
  const setupToken = await createLabAccountSetupToken({
    userId: params.owner.id,
    organizationId: params.organizationId,
    email: params.owner.email,
    purpose: "owner_claim",
    source: "public.self_serve_signup",
  });

  await sendLabAccountSetupEmail({
    email: params.owner.email,
    recipientName: params.owner.name,
    organizationName: params.organizationName,
    claimUrl: buildLabClaimUrl(params.appUrl, setupToken.token),
  });
}
