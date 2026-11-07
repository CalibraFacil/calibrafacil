import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  createR2Client,
  deleteFromR2,
  generatePresignedUrl,
  resolveBucketName,
  resolveReadBucketName,
  uploadToR2,
  type R2Env,
} from "../lib/storage";
import {
  buildOrganizationLogoUrl,
  decodeLogoAssetKey,
  getLogoKeyFromUrl,
  organizationLogoKey,
} from "@calibra-facil/shared/storage-keys";
import { writeOrganizationAuditEvent } from "../lib/audit";
import { orgDb } from "../lib/org-db";
import {
  type AuthVariables,
  requireRole,
  withLabPermission,
} from "../middleware/permission";

import { sniffRasterImage } from "../lib/image-sniff";
import { invalid, notFound } from "../lib/domain-errors";
import { withOrg } from "../lib/org-context";
import { requestActor } from "../middleware/request-actor";
const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024;
// Raster only: an SVG can carry script, and the logo is embedded in certificates.
const ALLOWED_LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_URL_EXPIRY = 900;

function orgNotFound() {
  return notFound("not_found", "Organização não encontrada");
}

export const organizationMediaRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>()
  .post(
    "/logo",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const env = c.env;

      const formData = await c.req.formData();
      const file = formData.get("logo");

      if (!(file instanceof File)) {
        throw invalid("invalid_request", "Nenhum arquivo enviado");
      }

      if (!ALLOWED_LOGO_CONTENT_TYPES.includes(file.type)) {
        throw invalid(
          "invalid_request",
          "Formato inválido. Use PNG, JPG ou WebP.",
        );
      }

      if (file.size > MAX_LOGO_FILE_SIZE) {
        throw invalid(
          "invalid_request",
          `Arquivo muito grande. Máximo ${MAX_LOGO_FILE_SIZE / 1024 / 1024}MB.`,
        );
      }

      const lab = orgDb(member.organizationId);
      const [currentOrg] = await lab
        .select({ logo: organization.logo, slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, member.organizationId))
        .limit(1);

      if (!currentOrg) {
        throw orgNotFound();
      }

      const { bucket, key } = organizationLogoKey({
        org: { id: member.organizationId, slug: currentOrg.slug },
        timestamp: Date.now(),
        uniqueId: randomUUID(),
      });
      const buffer = await file.arrayBuffer();
      // The stored type is what the bytes are, not what the client declared.
      const contentType = sniffRasterImage(buffer);
      if (!contentType) {
        throw invalid(
          "invalid_request",
          "Formato inválido. Use PNG, JPG ou WebP.",
        );
      }
      const r2Client = createR2Client(env);
      await uploadToR2(
        r2Client,
        resolveBucketName(env, bucket),
        key,
        buffer,
        contentType,
      );

      const logoUrl = buildOrganizationLogoUrl(key, new URL(c.req.url).origin);
      // The new logo and its audit entry commit together; the previous object
      // is removed from storage only once that has committed.
      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        await ctx.o
          .update(organization)
          .set({ logo: logoUrl })
          .where(eq(organization.id, member.organizationId));
        await writeOrganizationAuditEvent(
          {
            organizationId: member.organizationId,
            actorUserId: ctx.actor.userId,
            actorMemberId: member.id,
            action: "organization.logo.uploaded",
            entityType: "organization",
            entityId: member.organizationId,
            details: {
              key,
              contentType,
              size: file.size,
            },
          },
          ctx.o,
        );
      });

      const previousKey = getLogoKeyFromUrl(currentOrg.logo);
      if (previousKey && previousKey !== key) {
        const previousBucket = await resolveReadBucketName(
          r2Client,
          env,
          "media",
          previousKey,
        );
        await deleteFromR2(r2Client, previousBucket, previousKey).catch(
          () => undefined,
        );
      }

      return c.json({ logoUrl });
    },
  )
  .delete(
    "/logo",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const env = c.env;

      const lab = orgDb(member.organizationId);
      const [currentOrg] = await lab
        .select({ logo: organization.logo })
        .from(organization)
        .where(eq(organization.id, member.organizationId))
        .limit(1);

      if (!currentOrg) {
        throw orgNotFound();
      }

      const previousKey = getLogoKeyFromUrl(currentOrg.logo);

      // The cleared logo and its audit entry commit together; the object is
      // removed from storage only once that has committed.
      await withOrg(member.organizationId, requestActor(c), async (ctx) => {
        await ctx.o
          .update(organization)
          .set({ logo: null })
          .where(eq(organization.id, member.organizationId));
        await writeOrganizationAuditEvent(
          {
            organizationId: member.organizationId,
            actorUserId: ctx.actor.userId,
            actorMemberId: member.id,
            action: "organization.logo.deleted",
            entityType: "organization",
            entityId: member.organizationId,
            details: previousKey ? { key: previousKey } : null,
          },
          ctx.o,
        );
      });

      if (previousKey) {
        const r2Client = createR2Client(env);
        const previousBucket = await resolveReadBucketName(
          r2Client,
          env,
          "media",
          previousKey,
        );
        await deleteFromR2(r2Client, previousBucket, previousKey).catch(
          () => undefined,
        );
      }

      return c.json({ logoUrl: null });
    },
  )
  .get("/logo/:key", async (c) => {
    const env = c.env;
    const decodedKey = decodeLogoAssetKey(c.req.param("key"));

    if (!decodedKey) {
      throw invalid("invalid_request", "Asset inválido");
    }

    try {
      const r2Client = createR2Client(env);
      const bucketName = await resolveReadBucketName(
        r2Client,
        env,
        "media",
        decodedKey,
      );
      const url = await generatePresignedUrl(
        r2Client,
        bucketName,
        decodedKey,
        LOGO_URL_EXPIRY,
      );

      return c.redirect(url, 302);
    } catch (error) {
      console.error("Error fetching organization logo:", error);
      throw notFound("not_found", "Erro ao carregar logo");
    }
  });
