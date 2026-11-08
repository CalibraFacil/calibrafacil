/**
 * portal-branding.int.spec.ts: GET /branding against a real Postgres. The sign-in page asks for
 * the laboratory's name and logo before any session exists; the laboratory is learned from the
 * request Origin through its verified, active custom domain. Anything else answers nulls, so the
 * SPA falls back to the CalibraFácil branding.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organization,
  organizationCustomDomain,
} from "@calibra-facil/db/schema";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { portalRouter } from "./portal";

const LOGO = "https://api.test/logo/exemplo";

async function seedBrandedLab(domain: {
  hostname: string;
  verified: boolean;
  active: boolean;
}) {
  const lab = await seedOrg({ orgId: "lab-brand", userId: "user-brand" });
  await db
    .update(organization)
    .set({ name: "Laboratório Exemplo", logo: LOGO })
    .where(eq(organization.id, lab.orgId));
  await db.insert(organizationCustomDomain).values({
    id: "domain-brand",
    organizationId: lab.orgId,
    hostname: domain.hostname,
    verificationToken: "token",
    verifiedAt: domain.verified ? new Date("2026-01-02T00:00:00.000Z") : null,
    isActive: domain.active,
    createdBy: lab.userId,
  });
}

async function branding(origin?: string) {
  const response = await portalRouter.request(
    "/branding",
    origin ? { headers: { origin } } : {},
  );
  expect(response.status).toBe(200);
  return response.json();
}

const NULLS = { name: null, logo: null };

describe("GET /branding", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("returns the laboratory's name and logo for its verified, active custom domain", async () => {
    await seedBrandedLab({
      hostname: "portal.laboratorio.example",
      verified: true,
      active: true,
    });

    expect(await branding("https://portal.laboratorio.example")).toEqual({
      name: "Laboratório Exemplo",
      logo: LOGO,
    });
  });

  it("returns nulls for a custom domain that is not verified yet or not active", async () => {
    await seedBrandedLab({
      hostname: "portal.laboratorio.example",
      verified: false,
      active: true,
    });
    expect(await branding("https://portal.laboratorio.example")).toEqual(NULLS);

    await db
      .update(organizationCustomDomain)
      .set({ verifiedAt: new Date(), isActive: false });
    expect(await branding("https://portal.laboratorio.example")).toEqual(NULLS);
  });

  it("returns nulls on the default portal host, for an unrecognized domain, and with no Origin", async () => {
    await seedBrandedLab({
      hostname: "portal.laboratorio.example",
      verified: true,
      active: true,
    });

    expect(await branding("https://portal.calibrafacil.com")).toEqual(NULLS);
    expect(await branding("https://unknown.example.com")).toEqual(NULLS);
    expect(await branding()).toEqual(NULLS);
  });
});
