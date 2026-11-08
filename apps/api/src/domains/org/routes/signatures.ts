import { createRouter } from "../../../server/router";
import { signatureEndpoints } from "@calibra-facil/contracts";
import {
  memberVisualSignature,
  member,
  organization,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { invalid, notFound } from "../../../lib/domain-errors";
import { withOrg } from "../../../lib/org-context";
import { mount } from "../../../lib/endpoint-mount";
import { orgDb } from "../../../lib/org-db";
import { requestActor } from "../../../middleware/request-actor";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import {
  createR2Client,
  generatePresignedUrl,
  resolveBucketName,
  resolveReadBucketName,
  uploadToR2,
  deleteFromR2,
  type R2Env,
} from "../../../lib/storage";
import { memberSignatureKey } from "@calibra-facil/shared/storage-keys";

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const MIN_WIDTH = 100;
const MIN_HEIGHT = 50;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 400;
const ALLOWED_CONTENT_TYPES = ["image/png"];
const PRESIGNED_URL_EXPIRY = 300; // 5 minutes

/**
 * Extract PNG image dimensions from buffer.
 * PNG header format: 8 bytes magic + IHDR chunk (width at byte 16, height at byte 20)
 */
function getPngDimensions(
  buffer: ArrayBuffer,
): { width: number; height: number } | null {
  const view = new DataView(buffer);

  // Check PNG magic number (137 80 78 71 13 10 26 10)
  if (
    view.getUint8(0) !== 0x89 ||
    view.getUint8(1) !== 0x50 ||
    view.getUint8(2) !== 0x4e ||
    view.getUint8(3) !== 0x47
  ) {
    return null;
  }

  // Width and height are at bytes 16-19 and 20-23 (big-endian)
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  return { width, height };
}

const PREFIX = "/api/signatures";

export const signaturesRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

mount(
  signaturesRouter,
  PREFIX,
  signatureEndpoints.uploadMine,
  withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const env = c.env;

    const formData = await c.req.formData();
    const file = formData.get("signature");

    if (!(file instanceof File)) {
      throw invalid("invalid_request", "Nenhum arquivo enviado");
    }

    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      throw invalid(
        "invalid_request",
        "Formato inválido. Apenas PNG é permitido.",
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw invalid(
        "invalid_request",
        `Arquivo muito grande. Máximo ${MAX_FILE_SIZE / 1024}KB.`,
      );
    }

    const buffer = await file.arrayBuffer();

    const dimensions = getPngDimensions(buffer);
    if (!dimensions) {
      throw invalid("invalid_request", "Arquivo não é uma imagem PNG válida.");
    }

    if (dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT) {
      throw invalid(
        "invalid_request",
        `Imagem muito pequena. Mínimo ${MIN_WIDTH}x${MIN_HEIGHT} pixels.`,
      );
    }

    if (dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT) {
      throw invalid(
        "invalid_request",
        `Imagem muito grande. Máximo ${MAX_WIDTH}x${MAX_HEIGHT} pixels.`,
      );
    }

    // Generate R2 key (readable org-slug prefix; media bucket)
    const [orgRow] = await orgDb(memberData.organizationId)
      .select({ slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, memberData.organizationId))
      .limit(1);
    const { bucket, key: r2Key } = memberSignatureKey({
      org: { id: memberData.organizationId, slug: orgRow?.slug ?? "" },
      memberId: memberData.id,
    });

    const r2Client = createR2Client(env);
    await uploadToR2(
      r2Client,
      resolveBucketName(env, bucket),
      r2Key,
      buffer,
      file.type,
    );

    // Upsert database record (read + write in one organization-bound
    // transaction)
    await withOrg(memberData.organizationId, requestActor(c), async (ctx) => {
      const existingSignature = await ctx.o
        .select()
        .from(memberVisualSignature)
        .where(
          and(
            eq(memberVisualSignature.memberId, memberData.id),
            eq(memberVisualSignature.organizationId, memberData.organizationId),
          ),
        )
        .limit(1);

      const existing = existingSignature[0];
      if (existing) {
        await ctx.o
          .update(memberVisualSignature)
          .set({
            r2Key,
            contentType: file.type,
            width: dimensions.width,
            height: dimensions.height,
            fileSize: file.size,
            updatedAt: new Date(),
          })
          .where(eq(memberVisualSignature.id, existing.id));
      } else {
        await ctx.o.insert(memberVisualSignature).values({
          memberId: memberData.id,
          organizationId: memberData.organizationId,
          r2Key,
          contentType: file.type,
          width: dimensions.width,
          height: dimensions.height,
          fileSize: file.size,
        });
      }
    });

    return {
      message: "Assinatura enviada com sucesso",
      dimensions: { width: dimensions.width, height: dimensions.height },
    };
  },
);

mount(
  signaturesRouter,
  PREFIX,
  signatureEndpoints.getMine,
  withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const env = c.env;

    const [signature] = await orgDb(memberData.organizationId).transaction(
      (o) =>
        o
          .select()
          .from(memberVisualSignature)
          .where(
            and(
              eq(memberVisualSignature.memberId, memberData.id),
              eq(
                memberVisualSignature.organizationId,
                memberData.organizationId,
              ),
            ),
          )
          .limit(1),
    );

    if (!signature) {
      return { hasSignature: false as const };
    }

    const r2Client = createR2Client(env);
    const bucketName = await resolveReadBucketName(
      r2Client,
      env,
      "media",
      signature.r2Key,
    );
    const url = await generatePresignedUrl(
      r2Client,
      bucketName,
      signature.r2Key,
      PRESIGNED_URL_EXPIRY,
    );

    return {
      hasSignature: true as const,
      url,
      dimensions: { width: signature.width, height: signature.height },
      uploadedAt: signature.uploadedAt,
    };
  },
);

mount(
  signaturesRouter,
  PREFIX,
  signatureEndpoints.deleteMine,
  withLabPermission({ calibration: ["read"] }),
  async (c) => {
    const memberData = c.get("member");
    const env = c.env;

    const [signature] = await orgDb(memberData.organizationId).transaction(
      (o) =>
        o
          .select()
          .from(memberVisualSignature)
          .where(
            and(
              eq(memberVisualSignature.memberId, memberData.id),
              eq(
                memberVisualSignature.organizationId,
                memberData.organizationId,
              ),
            ),
          )
          .limit(1),
    );

    if (!signature) {
      throw notFound("not_found", "Nenhuma assinatura encontrada");
    }

    const r2Client = createR2Client(env);
    const bucketName = await resolveReadBucketName(
      r2Client,
      env,
      "media",
      signature.r2Key,
    );
    await deleteFromR2(r2Client, bucketName, signature.r2Key);

    await withOrg(memberData.organizationId, requestActor(c), (ctx) =>
      ctx.o
        .delete(memberVisualSignature)
        .where(eq(memberVisualSignature.id, signature.id)),
    );

    return { message: "Assinatura removida com sucesso" };
  },
);

// ===========================================================================
// GET /member/:memberId - Get another member's signature (for certificate gen)
// Admin/owner only, used internally for certificate generation
// ===========================================================================
signaturesRouter.get(
  "/member/:memberId",
  ...withLabPermission({ calibration: ["approve"] }),
  async (c) => {
    const { memberId } = c.req.param();
    const memberData = c.get("member");
    const env = c.env;

    const found = await orgDb(memberData.organizationId).transaction(
      async (o) => {
        const [targetMember] = await o
          .select()
          .from(member)
          .where(
            and(
              eq(member.id, memberId),
              eq(member.organizationId, memberData.organizationId),
            ),
          )
          .limit(1);

        if (!targetMember) return null;

        const [row] = await o
          .select()
          .from(memberVisualSignature)
          .where(
            and(
              eq(memberVisualSignature.memberId, memberId),
              eq(
                memberVisualSignature.organizationId,
                memberData.organizationId,
              ),
            ),
          )
          .limit(1);
        return { signature: row };
      },
    );

    if (!found) {
      throw notFound("member_not_found", "Membro não encontrado");
    }

    const { signature } = found;

    if (!signature) {
      return c.json({ hasSignature: false });
    }

    // Generate presigned URL with longer expiry for certificate generation
    const r2Client = createR2Client(env);
    const bucketName = await resolveReadBucketName(
      r2Client,
      env,
      "media",
      signature.r2Key,
    );
    const url = await generatePresignedUrl(
      r2Client,
      bucketName,
      signature.r2Key,
      3600, // 1 hour for certificate generation
    );

    return c.json({
      hasSignature: true,
      url,
      dimensions: { width: signature.width, height: signature.height },
    });
  },
);
