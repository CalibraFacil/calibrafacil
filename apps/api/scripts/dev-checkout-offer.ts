/**
 * Dev helper: mint a real self-serve checkout so the checkout screen can be
 * iterated on without walking the whole funnel every time.
 *
 * It runs exactly the code path the product runs — `issueCommercialOffer` at
 * list price — so what you see is the real thing, not a mock. That also means
 * it creates a real ASAAS customer in whatever environment `.env` points at
 * (sandbox by default) and a real `commercial_offer` row.
 *
 *   bun scripts/dev-checkout-offer.ts --list
 *   bun scripts/dev-checkout-offer.ts --org <id|slug> [--plan PROFESSIONAL]
 *        [--cycle YEARLY|MONTHLY] [--method CREDIT_CARD|PIX|BOLETO]
 *
 * `--offline` writes the same rows WITHOUT touching the payment provider, for
 * when there are no working sandbox credentials. The checkout screen renders
 * exactly as it will in production; only pressing "pay" cannot work, because
 * that is the moment the provider is actually called.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  billingCustomer,
  commercialDeal,
  commercialOffer,
  commercialOfferItem,
  organization,
} from "@calibra-facil/db/schema";
import { getPlan, getPlanPrice, type PlanId } from "@calibra-facil/shared";

import { issueCommercialOffer } from "../src/services/commercial/issue";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SELF_SERVE_PLANS = ["STANDARD", "PROFESSIONAL", "ADVANCED"] as const;

function isSelfServePlan(
  value: string,
): value is (typeof SELF_SERVE_PLANS)[number] {
  return SELF_SERVE_PLANS.some((plan) => plan === value);
}

function fail(message: string): never {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

async function listOrganizations() {
  const rows = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      cnpj: organization.cnpj,
    })
    .from(organization)
    .where(
      and(
        eq(organization.type, "LAB"),
        isNotNull(organization.cnpj),
        ne(organization.cnpj, ""),
      ),
    )
    .limit(25);

  if (rows.length === 0) {
    fail(
      "No LAB organization with a CNPJ in this database — billing cannot create a customer without one.",
    );
  }

  console.log("\nLaboratories that can be billed:\n");
  for (const row of rows) {
    console.log(`  ${row.slug.padEnd(28)} ${row.name}  (${row.id})`);
  }
  console.log("\nRe-run with --org <slug>\n");
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    fail("Refusing to run against a production environment.");
  }

  if (process.argv.includes("--list")) {
    await listOrganizations();
    return;
  }

  const orgRef = arg("org");
  if (!orgRef) fail("Missing --org <id|slug>. Use --list to see the options.");

  const org = await db.query.organization.findFirst({
    where: eq(organization.slug, orgRef),
  });
  const resolved =
    org ??
    (await db.query.organization.findFirst({
      where: eq(organization.id, orgRef),
    }));

  if (!resolved) fail(`No organization matching "${orgRef}".`);
  if (!resolved.cnpj?.trim()) {
    fail(
      `"${resolved.name}" has no CNPJ; ensureBillingCustomer refuses a blank one.`,
    );
  }

  const requestedPlan = (arg("plan") ?? "PROFESSIONAL").toUpperCase();
  if (!isSelfServePlan(requestedPlan)) {
    fail("--plan must be STANDARD, PROFESSIONAL or ADVANCED");
  }
  const planId: PlanId = requestedPlan;
  const cycle = (arg("cycle") ?? "YEARLY").toUpperCase();
  const method = (arg("method") ?? "CREDIT_CARD").toUpperCase();

  if (cycle !== "YEARLY" && cycle !== "MONTHLY") {
    fail("--cycle must be YEARLY or MONTHLY");
  }
  if (method !== "CREDIT_CARD" && method !== "PIX" && method !== "BOLETO") {
    fail("--method must be CREDIT_CARD, PIX or BOLETO");
  }

  const amount = getPlanPrice(planId, cycle);
  if (amount === null || amount === 0)
    fail(`No published price for ${planId}.`);

  const plan = getPlan(planId);
  const owner = await db.query.member.findFirst({
    where: (member, { eq: equals }) =>
      equals(member.organizationId, resolved.id),
  });

  if (process.argv.includes("--offline")) {
    const path = await createOfferWithoutProvider({
      organizationId: resolved.id,
      organizationName: resolved.name,
      cnpj: resolved.cnpj,
      planId,
      planName: plan.name,
      cycle,
      method,
      amount,
    });

    const offlineAppUrl = process.env.APP_URL ?? "http://localhost:5173";
    console.log(
      `\n✔ ${plan.name} · ${cycle} · ${method}  (offline, no provider)`,
    );
    console.log(`  ${resolved.name}`);
    console.log(`\n  ${offlineAppUrl}${path}\n`);
    console.log(
      '  Pressing "pagar" will fail: that step calls the provider.\n',
    );
    return;
  }

  const offer = await issueCommercialOffer(
    {
      organizationId: resolved.id,
      kind: "PLAN_RECURRING",
      basePlanId: planId,
      billingCycle: cycle,
      negotiatedAmount: amount,
      discountAmount: 0,
      setupFeeAmount: 0,
      paymentMethods: [method],
      customerVisibleDescription: `Plano ${plan.name} — assinatura ${
        cycle === "YEARLY" ? "anual" : "mensal"
      }`,
      internalNotes: "Oferta criada pelo script de desenvolvimento.",
      items: [],
    },
    owner?.userId ?? "dev-script",
    `dev-checkout:${randomUUID()}`,
  );

  const appUrl = process.env.APP_URL ?? "http://localhost:5173";
  console.log(`\n✔ ${plan.name} · ${cycle} · ${method}`);
  console.log(`  ${resolved.name}`);
  console.log(`\n  ${appUrl}${offer.customerCheckoutUrlPath}\n`);
}

/**
 * Mirrors what `issueCommercialOffer` persists, minus the provider calls, so a
 * checkout link exists to look at. Deliberately marked in the data
 * (`providerCustomerId: "dev-offline:*"`, internal notes) so nobody mistakes
 * one of these for a real offer.
 */
async function createOfferWithoutProvider(input: {
  organizationId: string;
  organizationName: string;
  cnpj: string | null;
  planId: PlanId;
  planName: string;
  cycle: "YEARLY" | "MONTHLY";
  method: string;
  amount: number;
}) {
  const existingCustomer = await db.query.billingCustomer.findFirst({
    where: eq(billingCustomer.organizationId, input.organizationId),
  });

  const customerId =
    existingCustomer?.id ??
    (
      await db
        .insert(billingCustomer)
        .values({
          organizationId: input.organizationId,
          provider: "ASAAS",
          providerCustomerId: `dev-offline:${randomUUID()}`,
          name: input.organizationName,
          taxId: input.cnpj,
        })
        .returning({ id: billingCustomer.id })
    )[0].id;

  const [deal] = await db
    .insert(commercialDeal)
    .values({
      organizationId: input.organizationId,
      title: `${input.organizationName} - Proposta de desenvolvimento`,
    })
    .returning({ id: commercialDeal.id });

  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const offerId = randomUUID();
  const label = `Plano ${input.planName} — assinatura ${
    input.cycle === "YEARLY" ? "anual" : "mensal"
  }`;

  await db.insert(commercialOffer).values({
    id: offerId,
    dealId: deal.id,
    organizationId: input.organizationId,
    billingCustomerId: customerId,
    kind: "PLAN_RECURRING",
    status: "PENDING_PAYMENT",
    provider: "ASAAS",
    providerMode: input.method === "CREDIT_CARD" ? "CHECKOUT" : "SUBSCRIPTION",
    activationBehavior: "IMMEDIATE_REPLACE",
    basePlanId: input.planId,
    billingCycle: input.cycle,
    renewalMode: "AUTOMATIC",
    currency: "BRL",
    subtotalAmount: input.amount,
    discountAmount: 0,
    totalAmount: input.amount,
    paymentMethods: [input.method],
    publicTokenHash: tokenHash,
    customerCheckoutUrlPath: `/checkout/${token}`,
    customerVisibleDescription: label,
    internalNotes: "Oferta de desenvolvimento (sem provedor de pagamento).",
    // The real issuer freezes the normalized preview here; the checkout screen
    // does not read it, but the column is NOT NULL for a reason — an offer
    // without its terms is not auditable.
    termsSnapshot: {
      source: "dev-checkout-offer script",
      kind: "PLAN_RECURRING",
      basePlanId: input.planId,
      billingCycle: input.cycle,
      paymentMethods: [input.method],
      totalAmount: input.amount,
    },
    customerSnapshot: {},
    dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  });

  await db.insert(commercialOfferItem).values({
    offerId,
    type: "PLAN",
    label,
    quantity: 1,
    unitAmount: input.amount,
    totalAmount: input.amount,
  });

  return `/checkout/${token}`;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
