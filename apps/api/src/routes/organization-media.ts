import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db } from "@calibra-facil/db";
import { organization, organizationMedia } from "@calibra-facil/db/schema";
import { and, desc, eq } from "drizzle-orm";
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
  organizationMediaKey,
} from "@calibra-facil/shared/storage-keys";
import { writeOrganizationAuditEvent } from "../lib/audit";
import {
  type AuthVariables,
  requireRole,
  withLabPermission,
} from "../middleware/permission";

const MAX_LOGO_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_LOGO_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];
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
            { error: "Formato inválido. Use PNG, JPG, WebP ou SVG." },
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

        const [currentOrg] = await db
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
        const r2Client = createR2Client(env);
        await uploadToR2(
          r2Client,
          resolveBucketName(env, bucket),
          key,
          buffer,
          file.type,
        );

        const logoUrl = buildOrganizationLogoUrl(
          key,
          new URL(c.req.url).origin,
        );
        await db
          .update(organization)
          .set({ logo: logoUrl })
          .where(eq(organization.id, member.organizationId));

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

        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "organization.logo.uploaded",
          entityType: "organization",
          entityId: member.organizationId,
          details: {
            key,
            contentType: file.type,
            size: file.size,
          },
        });

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
        const [currentOrg] = await db
          .select({ logo: organization.logo })
          .from(organization)
          .where(eq(organization.id, member.organizationId))
          .limit(1);

        if (!currentOrg) {
          return c.json({ error: "Organização não encontrada" }, 404);
        }

        await db
          .update(organization)
          .set({ logo: null })
          .where(eq(organization.id, member.organizationId));

        const previousKey = getLogoKeyFromUrl(currentOrg.logo);
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

        await writeOrganizationAuditEvent({
          organizationId: member.organizationId,
          actorUserId: session.user.id,
          actorMemberId: member.id,
          action: "organization.logo.deleted",
          entityType: "organization",
          entityId: member.organizationId,
          details: previousKey ? { key: previousKey } : null,
        });

        return c.json({ logoUrl: null });
      } catch (error) {
        console.error("Error deleting organization logo:", error);
        return c.json({ error: "Erro ao remover logo" }, 500);
      }
    },
  )
  // ---- org media library (wysiwyg editor images, roadmap item 3) ----
  .get(
    "/library",
    ...withLabPermission({ organization: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const items = await db
        .select({
          id: organizationMedia.id,
          fileName: organizationMedia.fileName,
          contentType: organizationMedia.contentType,
          sizeBytes: organizationMedia.sizeBytes,
          createdAt: organizationMedia.createdAt,
        })
        .from(organizationMedia)
        .where(eq(organizationMedia.organizationId, member.organizationId))
        .orderBy(desc(organizationMedia.createdAt));
      return c.json({ items });
    },
  )
  .post(
    "/library",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const env = c.env;
      const formData = await c.req.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return c.json({ error: "Nenhum arquivo enviado" }, 400);
      }
      if (!ALLOWED_LOGO_CONTENT_TYPES.includes(file.type)) {
        return c.json(
          { error: "Formato inválido. Use PNG, JPG, WebP ou SVG." },
          400,
        );
      }
      if (file.size > MAX_LOGO_FILE_SIZE) {
        return c.json({ error: "Arquivo maior que 2 MB" }, 400);
      }
      const org = await db.query.organization.findFirst({
        where: eq(organization.id, member.organizationId),
      });
      if (!org) return c.json({ error: "Organização não encontrada" }, 404);
      const { bucket, key } = organizationMediaKey({
        org: { id: org.id, slug: org.slug ?? "" },
        uniqueId: randomUUID(),
        fileName: file.name,
      });
      await uploadToR2(
        createR2Client(env),
        resolveBucketName(env, bucket),
        key,
        new Uint8Array(await file.arrayBuffer()),
        file.type,
      );
      const [created] = await db
        .insert(organizationMedia)
        .values({
          organizationId: member.organizationId,
          fileName: file.name,
          r2Key: key,
          contentType: file.type,
          sizeBytes: file.size,
          createdBy: session.user.id,
        })
        .returning();
      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "organization.media.uploaded",
        entityType: "organization",
        entityId: member.organizationId,
        details: { mediaId: created?.id, fileName: file.name },
      });
      return c.json({ item: created }, 201);
    },
  )
  .delete(
    "/library/:id",
    ...withLabPermission({ organization: ["update"] }),
    requireRole(["admin", "owner"]),
    async (c) => {
      const member = c.get("member");
      const session = c.get("session");
      const env = c.env;
      const id = Number.parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(id)) return c.json({ error: "Id inválido" }, 400);
      const row = await db.query.organizationMedia.findFirst({
        where: and(
          eq(organizationMedia.id, id),
          eq(organizationMedia.organizationId, member.organizationId),
        ),
      });
      if (!row) return c.json({ error: "Imagem não encontrada" }, 404);
      const r2Client = createR2Client(env);
      await deleteFromR2(
        r2Client,
        resolveBucketName(env, "media"),
        row.r2Key,
      ).catch(() => undefined);
      await db.delete(organizationMedia).where(eq(organizationMedia.id, id));
      await writeOrganizationAuditEvent({
        organizationId: member.organizationId,
        actorUserId: session.user.id,
        actorMemberId: member.id,
        action: "organization.media.deleted",
        entityType: "organization",
        entityId: member.organizationId,
        details: { mediaId: id, fileName: row.fileName },
      });
      return c.json({ ok: true });
    },
  )
  .get(
    "/library/:id/file",
    ...withLabPermission({ organization: ["update"] }),
    async (c) => {
      const member = c.get("member");
      const env = c.env;
      const id = Number.parseInt(c.req.param("id"), 10);
      if (!Number.isFinite(id)) return c.json({ error: "Id inválido" }, 400);
      const row = await db.query.organizationMedia.findFirst({
        where: and(
          eq(organizationMedia.id, id),
          eq(organizationMedia.organizationId, member.organizationId),
        ),
      });
      if (!row) return c.json({ error: "Imagem não encontrada" }, 404);
      const r2Client = createR2Client(env);
      const bucketName = await resolveReadBucketName(
        r2Client,
        env,
        "media",
        row.r2Key,
      );
      const url = await generatePresignedUrl(
        r2Client,
        bucketName,
        row.r2Key,
        LOGO_URL_EXPIRY,
      );
      return c.redirect(url, 302);
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
