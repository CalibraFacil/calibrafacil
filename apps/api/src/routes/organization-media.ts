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
import { domainErrorResponse, invalid } from "../lib/domain-errors";
const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024;
// Raster only: an SVG can carry script, and the logo is embedded in certificates.
const ALLOWED_LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_URL_EXPIRY = 900;
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
      const session = c.get("session");
      const env = c.env;

      try {
        const formData = await c.req.formData();
        const file = formData.get("logo");

        if (!(file instanceof File)) {
          return c.json({ error: "Nenhum arquivo enviado" }, 400);
        }

        if (!ALLOWED_LOGO_CONTENT_TYPES.includes(file.type)) {
          return c.json(
            { error: "Formato inválido. Use PNG, JPG ou WebP." },
            400,
          );
        }

        if (file.size > MAX_LOGO_FILE_SIZE) {
          return c.json(
            {
              error: `Arquivo muito grande. Máximo ${MAX_LOGO_FILE_SIZE / 1024 / 1024}MB.`,
            },
            400,
          );
        }

        const lab = orgDb(member.organizationId);
        const [currentOrg] = await lab
          .select({ logo: organization.logo, slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, member.organizationId))
          .limit(1);

        if (!currentOrg) {
          return c.json({ error: "Organização não encontrada" }, 404);
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
          return domainErrorResponse(
            c,
            invalid(
              "invalid_request",
              "Formato inválido. Use PNG, JPG ou WebP.",
            ),
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

        const logoUrl = buildOrganizationLogoUrl(
          key,
          new URL(c.req.url).origin,
        );
        // The new logo and its audit entry commit together; the previous object
        // is removed from storage only once that has committed.
        await lab.transaction(async (tx) => {
          await tx
            .update(organization)
            .set({ logo: logoUrl })
            .where(eq(organization.id, member.organizationId));
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
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
            tx,
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
      } catch (error) {
        console.error("Error uploading organization logo:", error);
        return c.json({ error: "Erro ao enviar logo" }, 500);
      }
    },
  )
  .delete(
    "/logo",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const env = c.env;

      try {
        const lab = orgDb(member.organizationId);
        const [currentOrg] = await lab
          .select({ logo: organization.logo })
          .from(organization)
          .where(eq(organization.id, member.organizationId))
          .limit(1);

        if (!currentOrg) {
          return c.json({ error: "Organização não encontrada" }, 404);
        }

        const previousKey = getLogoKeyFromUrl(currentOrg.logo);

        // The cleared logo and its audit entry commit together; the object is
        // removed from storage only once that has committed.
        await lab.transaction(async (tx) => {
          await tx
            .update(organization)
            .set({ logo: null })
            .where(eq(organization.id, member.organizationId));
          await writeOrganizationAuditEvent(
            {
              organizationId: member.organizationId,
              actorUserId: session.user.id,
              actorMemberId: member.id,
              action: "organization.logo.deleted",
              entityType: "organization",
              entityId: member.organizationId,
              details: previousKey ? { key: previousKey } : null,
            },
            tx,
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
      } catch (error) {
        console.error("Error deleting organization logo:", error);
        return c.json({ error: "Erro ao remover logo" }, 500);
      }
    },
  )
  .get("/logo/:key", async (c) => {
    const env = c.env;
    const decodedKey = decodeLogoAssetKey(c.req.param("key"));

    if (!decodedKey) {
      return c.json({ error: "Asset inválido" }, 400);
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
      return c.json({ error: "Erro ao carregar logo" }, 404);
    }
  });
