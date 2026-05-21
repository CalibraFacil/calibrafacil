import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  createR2Client,
  deleteFromR2,
  generatePresignedUrl,
  uploadToR2,
  type R2Env,
} from "../lib/storage";
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
const ORGANIZATION_LOGO_KEY_PREFIX = "organization-logos/";

function buildOrganizationLogoKey(organizationId: string): string {
  return `${ORGANIZATION_LOGO_KEY_PREFIX}${organizationId}/${Date.now()}-${randomUUID()}`;
}

function encodeLogoAssetKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeLogoAssetKey(key: string): string | null {
  try {
    const decoded = Buffer.from(key, "base64url").toString("utf8");
    return decoded.startsWith(ORGANIZATION_LOGO_KEY_PREFIX) ? decoded : null;
  } catch {
    return null;
  }
}

function buildOrganizationLogoUrl(key: string, requestUrl: string): string {
  const origin = new URL(requestUrl).origin;
  return `${origin}/api/organization-media/logo/${encodeLogoAssetKey(key)}`;
}

function getLogoKeyFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    const marker = "/api/organization-media/logo/";
    const markerIndex = url.pathname.indexOf(marker);
    if (markerIndex === -1) return null;

    const encodedKey = url.pathname.slice(markerIndex + marker.length);
    return decodeLogoAssetKey(encodedKey);
  } catch {
    return null;
  }
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
          .select({ logo: organization.logo })
          .from(organization)
          .where(eq(organization.id, member.organizationId))
          .limit(1);

        if (!currentOrg) {
          return c.json({ error: "Organização não encontrada" }, 404);
        }

        const key = buildOrganizationLogoKey(member.organizationId);
        const buffer = await file.arrayBuffer();
        const r2Client = createR2Client(env);
        await uploadToR2(r2Client, env.R2_BUCKET_NAME, key, buffer, file.type);

        const logoUrl = buildOrganizationLogoUrl(key, c.req.url);
        await db
          .update(organization)
          .set({ logo: logoUrl })
          .where(eq(organization.id, member.organizationId));

        const previousKey = getLogoKeyFromUrl(currentOrg.logo);
        if (previousKey && previousKey !== key) {
          await deleteFromR2(r2Client, env.R2_BUCKET_NAME, previousKey).catch(
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
          await deleteFromR2(r2Client, env.R2_BUCKET_NAME, previousKey).catch(
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
  .get("/logo/:key", async (c) => {
    const env = c.env;
    const decodedKey = decodeLogoAssetKey(c.req.param("key"));

    if (!decodedKey) {
      return c.json({ error: "Asset inválido" }, 400);
    }

    try {
      const r2Client = createR2Client(env);
      const url = await generatePresignedUrl(
        r2Client,
        env.R2_BUCKET_NAME,
        decodedKey,
        LOGO_URL_EXPIRY,
      );

      return c.redirect(url, 302);
    } catch (error) {
      console.error("Error fetching organization logo:", error);
      return c.json({ error: "Erro ao carregar logo" }, 404);
    }
  });
