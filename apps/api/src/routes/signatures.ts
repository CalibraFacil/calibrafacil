import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { memberVisualSignature, member } from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../middleware/permission";
import {
  createR2Client,
  generatePresignedUrl,
  uploadToR2,
  deleteFromR2,
  type R2Env,
} from "../lib/storage";

// =============================================================================
// CONSTANTS
// =============================================================================

const MAX_FILE_SIZE = 500 * 1024; // 500KB
const MIN_WIDTH = 100;
const MIN_HEIGHT = 50;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 400;
const ALLOWED_CONTENT_TYPES = ["image/png"];
const PRESIGNED_URL_EXPIRY = 300; // 5 minutes

// =============================================================================
// IMAGE DIMENSION VALIDATION
// =============================================================================

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

// =============================================================================
// ROUTES
// =============================================================================

export const signaturesRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>()
  // ===========================================================================
  // POST /my-signature - Upload own signature
  // ===========================================================================
  .post(
    "/my-signature",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const env = c.env;

      try {
        // Parse multipart form data
        const formData = await c.req.formData();
        const file = formData.get("signature");

        if (!(file instanceof File)) {
          return c.json({ error: "Nenhum arquivo enviado" }, 400);
        }

        // Validate content type
        if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
          return c.json(
            { error: "Formato inválido. Apenas PNG é permitido." },
            400,
          );
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          return c.json(
            {
              error: `Arquivo muito grande. Máximo ${MAX_FILE_SIZE / 1024}KB.`,
            },
            400,
          );
        }

        // Read file buffer
        const buffer = await file.arrayBuffer();

        // Validate PNG and get dimensions
        const dimensions = getPngDimensions(buffer);
        if (!dimensions) {
          return c.json({ error: "Arquivo não é uma imagem PNG válida." }, 400);
        }

        // Validate dimensions
        if (dimensions.width < MIN_WIDTH || dimensions.height < MIN_HEIGHT) {
          return c.json(
            {
              error: `Imagem muito pequena. Mínimo ${MIN_WIDTH}x${MIN_HEIGHT} pixels.`,
            },
            400,
          );
        }

        if (dimensions.width > MAX_WIDTH || dimensions.height > MAX_HEIGHT) {
          return c.json(
            {
              error: `Imagem muito grande. Máximo ${MAX_WIDTH}x${MAX_HEIGHT} pixels.`,
            },
            400,
          );
        }

        // Generate R2 key
        const r2Key = `signatures/${memberData.organizationId}/${memberData.id}.png`;

        // Upload to R2
        const r2Client = createR2Client(env);
        await uploadToR2(
          r2Client,
          env.R2_BUCKET_NAME,
          r2Key,
          buffer,
          file.type,
        );

        // Upsert database record
        const existingSignature = await db
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
          .limit(1);

        const existing = existingSignature[0];
        if (existing) {
          // Update existing
          await db
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
          // Insert new
          await db.insert(memberVisualSignature).values({
            memberId: memberData.id,
            organizationId: memberData.organizationId,
            r2Key,
            contentType: file.type,
            width: dimensions.width,
            height: dimensions.height,
            fileSize: file.size,
          });
        }

        return c.json({
          message: "Assinatura enviada com sucesso",
          dimensions: { width: dimensions.width, height: dimensions.height },
        });
      } catch (error) {
        console.error("Error uploading signature:", error);
        return c.json({ error: "Erro ao enviar assinatura" }, 500);
      }
    },
  )

  // ===========================================================================
  // GET /my-signature - Get own signature URL
  // ===========================================================================
  .get(
    "/my-signature",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const env = c.env;

      try {
        const [signature] = await db
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
          .limit(1);

        if (!signature) {
          return c.json({ hasSignature: false });
        }

        // Generate presigned URL
        const r2Client = createR2Client(env);
        const url = await generatePresignedUrl(
          r2Client,
          env.R2_BUCKET_NAME,
          signature.r2Key,
          PRESIGNED_URL_EXPIRY,
        );

        return c.json({
          hasSignature: true,
          url,
          dimensions: { width: signature.width, height: signature.height },
          uploadedAt: signature.uploadedAt,
        });
      } catch (error) {
        console.error("Error fetching signature:", error);
        return c.json({ error: "Erro ao buscar assinatura" }, 500);
      }
    },
  )

  // ===========================================================================
  // DELETE /my-signature - Remove own signature
  // ===========================================================================
  .delete(
    "/my-signature",
    ...withLabPermission({ calibration: ["read"] }),
    async (c) => {
      const memberData = c.get("member");
      const env = c.env;

      try {
        const [signature] = await db
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
          .limit(1);

        if (!signature) {
          return c.json({ error: "Nenhuma assinatura encontrada" }, 404);
        }

        // Delete from R2
        const r2Client = createR2Client(env);
        await deleteFromR2(r2Client, env.R2_BUCKET_NAME, signature.r2Key);

        // Delete from database
        await db
          .delete(memberVisualSignature)
          .where(eq(memberVisualSignature.id, signature.id));

        return c.json({ message: "Assinatura removida com sucesso" });
      } catch (error) {
        console.error("Error deleting signature:", error);
        return c.json({ error: "Erro ao remover assinatura" }, 500);
      }
    },
  )

  // ===========================================================================
  // GET /member/:memberId - Get another member's signature (for certificate gen)
  // Admin/owner only, used internally for certificate generation
  // ===========================================================================
  .get(
    "/member/:memberId",
    ...withLabPermission({ calibration: ["approve"] }), // Only admins/owners can approve
    async (c) => {
      const { memberId } = c.req.param();
      const memberData = c.get("member");
      const env = c.env;

      try {
        // Verify the requested member belongs to the same organization
        const [targetMember] = await db
          .select()
          .from(member)
          .where(
            and(
              eq(member.id, memberId),
              eq(member.organizationId, memberData.organizationId),
            ),
          )
          .limit(1);

        if (!targetMember) {
          return c.json({ error: "Membro não encontrado" }, 404);
        }

        const [signature] = await db
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

        if (!signature) {
          return c.json({ hasSignature: false });
        }

        // Generate presigned URL with longer expiry for certificate generation
        const r2Client = createR2Client(env);
        const url = await generatePresignedUrl(
          r2Client,
          env.R2_BUCKET_NAME,
          signature.r2Key,
          3600, // 1 hour for certificate generation
        );

        return c.json({
          hasSignature: true,
          url,
          dimensions: { width: signature.width, height: signature.height },
        });
      } catch (error) {
        console.error("Error fetching member signature:", error);
        return c.json({ error: "Erro ao buscar assinatura do membro" }, 500);
      }
    },
  );
