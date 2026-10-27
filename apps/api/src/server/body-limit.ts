import { readRuntimeConfig } from "@calibra-facil/config";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "./env";

/**
 * The largest request body the API reads (roadmap 2 D1, review 3.3):
 * `API_MAX_BODY_BYTES`, 413 above it. The Bun entry also caps the socket
 * (`maxRequestBodySize`) at the same size, so an oversized body is not buffered.
 */
export function applyBodyLimit(app: Hono<{ Bindings: Env }>) {
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: readRuntimeConfig().maxBodyBytes,
      onError: (c) =>
        c.json(
          {
            error: "O conteúdo enviado é maior do que o permitido.",
            code: "PAYLOAD_TOO_LARGE",
          },
          413,
        ),
    }),
  );
}
