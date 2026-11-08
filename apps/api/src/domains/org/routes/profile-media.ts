import { readOriginsConfig } from "@calibra-facil/config";
import { createRouter } from "../../../server/router";
import { profileMediaEndpoints } from "@calibra-facil/contracts";
import { findUserImage } from "../identity";
import {
  createR2Client,
  deleteFromR2,
  generatePresignedUrl,
  resolveBucketName,
  resolveReadBucketName,
  uploadToR2,
  type R2Env,
} from "../../../lib/storage";
import { avatarKey } from "@calibra-facil/shared/storage-keys";
import {
  requireAuth,
  type AuthVariables,
} from "../../../middleware/permission";

import { sniffRasterImage } from "../../../lib/image-sniff";
import { invalid, notFound } from "../../../lib/domain-errors";
import { mount } from "../../../lib/endpoint-mount";
const MAX_AVATAR_FILE_SIZE = 2 * 1024 * 1024;
const ALLOWED_AVATAR_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"];
const AVATAR_URL_EXPIRY = 300;

function getAvatarApiUrl(): string {
  return `${readOriginsConfig().apiBaseUrl}/api/profile-media/avatar`;
}

const PREFIX = "/api/profile-media";

export const profileMediaRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: R2Env;
}>();

mount(
  profileMediaRouter,
  PREFIX,
  profileMediaEndpoints.uploadAvatar,
  [requireAuth],
  async (c) => {
    const session = c.get("session");
    const env = c.env;

    const formData = await c.req.formData();
    const file = formData.get("avatar");

    if (!(file instanceof File)) {
      throw invalid("invalid_request", "Nenhum arquivo enviado");
    }

    if (!ALLOWED_AVATAR_CONTENT_TYPES.includes(file.type)) {
      throw invalid(
        "invalid_request",
        "Formato inválido. Use PNG, JPG ou WebP.",
      );
    }

    if (file.size > MAX_AVATAR_FILE_SIZE) {
      throw invalid(
        "invalid_request",
        `Arquivo muito grande. Máximo ${MAX_AVATAR_FILE_SIZE / 1024 / 1024}MB.`,
      );
    }

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
    const avatar = avatarKey(session.user.id);

    await uploadToR2(
      r2Client,
      resolveBucketName(env, avatar.bucket),
      avatar.key,
      buffer,
      contentType,
    );

    return {
      imageUrl: getAvatarApiUrl(),
    };
  },
);

profileMediaRouter.get("/avatar", requireAuth, async (c) => {
  const session = c.get("session");
  const env = c.env;

  const image = await findUserImage(session.user.id);

  if (!image) {
    throw notFound("not_found", "Avatar não configurado");
  }

  const r2Client = createR2Client(env);
  const avatar = avatarKey(session.user.id);
  const bucketName = await resolveReadBucketName(
    r2Client,
    env,
    avatar.bucket,
    avatar.key,
  );
  const url = await generatePresignedUrl(
    r2Client,
    bucketName,
    avatar.key,
    AVATAR_URL_EXPIRY,
  );

  return c.redirect(url, 302);
});

mount(
  profileMediaRouter,
  PREFIX,
  profileMediaEndpoints.deleteAvatar,
  [requireAuth],
  async (c) => {
    const session = c.get("session");
    const env = c.env;

    const r2Client = createR2Client(env);
    const avatar = avatarKey(session.user.id);
    const bucketName = await resolveReadBucketName(
      r2Client,
      env,
      avatar.bucket,
      avatar.key,
    );
    await deleteFromR2(r2Client, bucketName, avatar.key).catch(() => undefined);

    return { success: true as const };
  },
);
