/**
 * admin-organization-contract.int.spec.ts: the cloud half of the
 * organization-lifecycle, organization-profile, organization-media and
 * profile-media endpoint definitions
 * (`packages/contracts/src/endpoints/{organization-lifecycle,organization-profile,organization-media,profile-media}.ts`).
 * Each client-facing endpoint is called for real (real handlers, real
 * middleware, real Postgres; the object store is mocked) and its body is parsed
 * with the response schema of its definition. `mount` also checks each body
 * with that schema in the integration tier (`checkEndpointResponses`), so a
 * drift fails the request itself; the explicit parse here names the drifting
 * path and the status.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

vi.mock("../../../lib/storage", () => ({
  createR2Client: () => ({}),
  uploadToR2: () => Promise.resolve(),
  deleteFromR2: () => Promise.resolve(),
  generatePresignedUrl: () => Promise.resolve("https://r2.test/signed"),
  resolveBucketName: () => "media-test",
  resolveReadBucketName: () => Promise.resolve("media-test"),
}));

import {
  organizationLifecycleEndpoints,
  organizationMediaEndpoints,
  organizationProfileEndpoints,
  profileMediaEndpoints,
} from "@calibra-facil/contracts";
import { organizationLifecycleRouter } from "./organization-lifecycle";
import { organizationMediaRouter } from "./organization-media";
import { organizationProfileRouter } from "./organization-profile";
import { profileMediaRouter } from "./profile-media";
import { loginAs } from "../../../../test/integration/setup";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";

const JSON_HEADERS = { "content-type": "application/json" };

/** Parses with the definition's response schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

function pngForm(field: string) {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const form = new FormData();
  form.append(field, new File([bytes], `${field}.png`, { type: "image/png" }));
  return form;
}

async function seedOwner(orgId: string) {
  const org = await seedOrg({ orgId, role: "owner" });
  loginAs({ userId: org.userId, organizationId: org.orgId });
  return org;
}

describe("organization endpoints: real responses honor the definitions' response schemas", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("profile update, logo upload and delete, avatar upload and delete", async () => {
    await seedOwner("org-org-contract");

    const profile = await parsedBody(
      await organizationProfileRouter.request("/profile", {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          accreditationActive: true,
          accreditationNumber: "CAL 0123",
          accreditationValidFrom: "2026-01-01T00:00:00.000Z",
          city: "Campinas",
        }),
      }),
      organizationProfileEndpoints.update.response,
    );
    expect(profile).toMatchObject({
      accreditationActive: true,
      city: "Campinas",
    });

    const logo = await parsedBody(
      await organizationMediaRouter.request("/logo", {
        method: "POST",
        body: pngForm("logo"),
      }),
      organizationMediaEndpoints.uploadLogo.response,
    );
    expect(logo.logoUrl.length).toBeGreaterThan(0);
    await parsedBody(
      await organizationMediaRouter.request("/logo", { method: "DELETE" }),
      organizationMediaEndpoints.deleteLogo.response,
    );

    const avatar = await parsedBody(
      await profileMediaRouter.request("/avatar", {
        method: "POST",
        body: pngForm("avatar"),
      }),
      profileMediaEndpoints.uploadAvatar.response,
    );
    expect(avatar.imageUrl.length).toBeGreaterThan(0);
    await parsedBody(
      await profileMediaRouter.request("/avatar", { method: "DELETE" }),
      profileMediaEndpoints.deleteAvatar.response,
    );
  });

  it("softDelete answers the deletion date once the owner types the laboratory's name", async () => {
    await seedOwner("org-life-contract");

    const refused = await organizationLifecycleRouter.request("/soft-delete", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        confirmName: "outro nome",
        reason: "Encerramento das atividades",
      }),
    });
    expect(refused.status).toBe(400);

    const deleted = await parsedBody(
      await organizationLifecycleRouter.request("/soft-delete", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          confirmName: "Lab org-life-contract",
          reason: "Encerramento das atividades",
        }),
      }),
      organizationLifecycleEndpoints.softDelete.response,
    );
    expect(deleted.success).toBe(true);
  });
});
