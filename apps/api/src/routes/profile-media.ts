import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { user } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import {
  createR2Client,
  deleteFromR2,
  generatePresignedUrl,
  uploadToR2,
  type R2Env,
} from "../lib/storage";
import {
  requireAuth,
  type AuthVariables,
} from "../middleware/permission";

const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_CONTENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
];
const AVATAR_URL_EXPIRY = 300;

function getAvatarApiUrl(): string {
  return `${process.env.API_URL || "https://localhost:3000"}/api/profile-media/avatar`;
}

function getAvatarKey(userId: string): string {
  return `avatars/${userId}`;
}

export const profileMediaRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>()
  .post("/avatar", requireAuth, async (c) => {
    const session = c.get("session");
    const env = c.env as R2Env;

    try {
      const formData = await c.req.formData();
      const file = formData.get("avatar") as File | null;

      if (!file) {
        return c.json({ error: "Nenhum arquivo enviado" }, 400);
      }

      if (!ALLOWED_AVATAR_CONTENT_TYPES.includes(file.type)) {
        return c.json(
          { error: "Formato inválido. Use PNG, JPG ou WebP." },
          400,
        );
      }

      if (file.size > MAX_AVATAR_FILE_SIZE) {
        return c.json(
          {
            error: `Arquivo muito grande. Máximo ${MAX_AVATAR_FILE_SIZE / 1024 / 1024}MB.`,
          },
          400,
        );
      }

      const buffer = await file.arrayBuffer();
      const r2Client = createR2Client(env);

      await uploadToR2(
        r2Client,
        env.R2_BUCKET_NAME,
        getAvatarKey(session.user.id),
        buffer,
        file.type,
      );

      return c.json({
        imageUrl: getAvatarApiUrl(),
      });
    } catch (error) {
      console.error("Error uploading avatar:", error);
      return c.json({ error: "Erro ao enviar avatar" }, 500);
    }
  })
  .get("/avatar", requireAuth, async (c) => {
    const session = c.get("session");
    const env = c.env as R2Env;

    const [currentUser] = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    if (!currentUser?.image) {
      return c.json({ error: "Avatar não configurado" }, 404);
    }

    try {
      const r2Client = createR2Client(env);
      const url = await generatePresignedUrl(
        r2Client,
        env.R2_BUCKET_NAME,
        getAvatarKey(session.user.id),
        AVATAR_URL_EXPIRY,
      );

      return c.redirect(url, 302);
    } catch (error) {
      console.error("Error fetching avatar:", error);
      return c.json({ error: "Erro ao carregar avatar" }, 500);
    }
  })
  .delete("/avatar", requireAuth, async (c) => {
    const session = c.get("session");
    const env = c.env as R2Env;

    try {
      const r2Client = createR2Client(env);
      await deleteFromR2(r2Client, env.R2_BUCKET_NAME, getAvatarKey(session.user.id)).catch(
        () => undefined,
      );

      return c.json({ success: true });
    } catch (error) {
      console.error("Error deleting avatar:", error);
      return c.json({ error: "Erro ao remover avatar" }, 500);
    }
  });
