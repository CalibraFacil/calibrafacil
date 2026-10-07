/**
 * Create a laboratory and print the link its first administrator uses to
 * claim it:
 *
 *   pnpm --dir apps/api create-lab --name "Laboratório Exemplo" \
 *     --email ana@laboratorio.example [--owner "Ana Souza"] [--cnpj ...]
 *
 * In Docker: docker compose -f docker-compose.prod.yml run --rm init \
 *   create-lab --name ... --email ...
 *
 * The claim page lets the administrator create a passkey right away, so the
 * printed link works even before e-mail is set up; when it is, the link is
 * also sent to the address given (skip that with --no-email). Reads the same
 * environment as the API (DATABASE_URL, BETTER_AUTH_SECRET, APP_URL…).
 */
import { parseArgs } from "node:util";
import { sendLabAccountSetupEmail } from "@calibra-facil/auth";
import {
  buildLabClaimUrl,
  createLabAccountSetupToken,
} from "@calibra-facil/auth/lab-access";
import { isPlatformEmailConfigured } from "@calibra-facil/email-sender";
import { z } from "zod";

import { ensurePortalServiceUser } from "../lib/portal-service-account";
import { provisionLabAccount } from "../services/lab-provisioning";

const USAGE = `Usage: create-lab --name <laboratory name> --email <administrator e-mail>
                  [--owner <administrator name>] [--cnpj <CNPJ>] [--no-email]`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      owner: { type: "string" },
      cnpj: { type: "string" },
      "no-email": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const labName = values.name?.trim();
  if (!labName) fail("--name is required.");
  const email = values.email?.trim().toLowerCase();
  if (!email || !z.email().safeParse(email).success) {
    fail("--email must be a valid e-mail address.");
  }
  const appUrl = process.env.APP_URL?.trim();
  if (!appUrl) fail("APP_URL is not set: it is where the claim link points.");

  const service = await ensurePortalServiceUser();
  if (service.created) {
    console.log(`Created the portal service account (${service.id}).`);
  }

  const provisioned = await provisionLabAccount({
    lab: { name: labName, email, cnpj: values.cnpj?.trim() || undefined },
    owner: { name: values.owner?.trim() || email, email },
  });

  const setupToken = await createLabAccountSetupToken({
    userId: provisioned.owner.id,
    organizationId: provisioned.organization.id,
    email: provisioned.owner.email,
    purpose: "owner_claim",
    source: "cli.create_lab",
  });
  const claimUrl = buildLabClaimUrl(appUrl, setupToken.token);

  let emailed = false;
  if (!values["no-email"] && isPlatformEmailConfigured()) {
    try {
      await sendLabAccountSetupEmail({
        email: provisioned.owner.email,
        recipientName: provisioned.owner.name,
        organizationName: provisioned.organization.name,
        claimUrl,
      });
      emailed = true;
    } catch (error) {
      console.warn(
        `Could not e-mail the link (${error instanceof Error ? error.message : String(error)}); use the one below.`,
      );
    }
  }

  console.log(`
Laboratory "${provisioned.organization.name}" created (${provisioned.organization.slug}).
Administrator: ${provisioned.owner.email}${provisioned.ownerCreated ? "" : " (existing account)"}

Claim link, valid until ${setupToken.expiresAt.toISOString()}${emailed ? ", also sent by e-mail" : ""}:

  ${claimUrl}

Open it to create a passkey and sign in. It works once; run create-lab again
for a new laboratory, or invite more people from the app.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("create-lab failed:", error);
    process.exit(1);
  });
