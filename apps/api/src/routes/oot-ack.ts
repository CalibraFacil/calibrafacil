import { Hono } from "hono";
import { notifyOotAcknowledged } from "@calibra-facil/notifications";
import {
  findOotNotificationByAckToken,
  stampOotAcknowledgementByLink,
} from "../lib/oot-acknowledgement";

/**
 * Public §7.10 acknowledgement router - NO AUTH REQUIRED (#426 Phase 0).
 *
 * The out-of-tolerance notification e-mail carries an unguessable ack-token
 * link. GET renders a small pt-BR confirmation page (a plain link must never
 * mutate state — mail scanners prefetch URLs); the page's button POSTs back to
 * the same path, which stamps the acknowledgement. Confirmation is evidence of
 * RECEIPT only, never agreement with the notification's content.
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(title)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #1a1d21; margin: 0; padding: 24px; }
  .card { max-width: 480px; margin: 48px auto; background: #fff; border: 1px solid #e2e5e9; border-radius: 12px; padding: 32px; }
  h1 { font-size: 1.15rem; margin: 0 0 12px; }
  p { font-size: 0.95rem; line-height: 1.5; margin: 0 0 12px; color: #3d434b; }
  .muted { font-size: 0.8rem; color: #6b7280; }
  button { background: #b45309; color: #fff; border: 0; border-radius: 8px; padding: 12px 20px; font-size: 0.95rem; cursor: pointer; }
  .ok { color: #15803d; font-weight: 600; }
</style>
</head>
<body><div class="card">${body}</div></body>
</html>`;
}

type AckNotification = NonNullable<
  Awaited<ReturnType<typeof findOotNotificationByAckToken>>
>;

function notificationContext(notification: AckNotification): string {
  return `<p>Notificação de resultado fora de tolerância <strong>${esc(
    notification.ncNumber,
  )}</strong>${
    notification.certificateNumber
      ? ` — certificado <strong>${esc(notification.certificateNumber)}</strong>`
      : ""
  }, emitida por <strong>${esc(notification.labName)}</strong>.</p>`;
}

/** The page of a notification whose receipt is already on record (first click wins). */
function alreadyConfirmedPage(notification: AckNotification): string {
  return page(
    "Recebimento já confirmado",
    `<h1>Recebimento já confirmado</h1>${notificationContext(notification)}<p class="ok">O recebimento desta notificação já foi confirmado.</p>`,
  );
}

export const ootAckRouter = new Hono()
  // =========================================================================
  // GET /:token - Confirmation page (no state change)
  // =========================================================================
  .get("/:token", async (c) => {
    const token = c.req.param("token");
    if (!UUID_REGEX.test(token)) {
      return c.html(
        page(
          "Link inválido",
          `<h1>Link inválido</h1><p>Este link de confirmação não é válido.</p>`,
        ),
        400,
      );
    }

    const notification = await findOotNotificationByAckToken(token);
    if (!notification) {
      return c.html(
        page(
          "Notificação não encontrada",
          `<h1>Notificação não encontrada</h1><p>Este link de confirmação não corresponde a nenhuma notificação.</p>`,
        ),
        404,
      );
    }

    const context = notificationContext(notification);

    if (notification.acknowledgedAt) {
      return c.html(alreadyConfirmedPage(notification));
    }

    return c.html(
      page(
        "Confirmar recebimento",
        `<h1>Confirmar recebimento</h1>${context}
<p>Ao confirmar, você registra apenas o <strong>recebimento</strong> desta notificação (ABNT NBR ISO/IEC 17025, item 7.10). A confirmação não implica concordância com o conteúdo.</p>
<form method="post"><button type="submit">Confirmo o recebimento</button></form>
<p class="muted">Em caso de dúvidas, responda ao e-mail da notificação ou contate o laboratório.</p>`,
      ),
    );
  })

  // =========================================================================
  // POST /:token - Stamp the acknowledgement (idempotent)
  // =========================================================================
  .post("/:token", async (c) => {
    const token = c.req.param("token");
    if (!UUID_REGEX.test(token)) {
      return c.html(
        page(
          "Link inválido",
          `<h1>Link inválido</h1><p>Este link de confirmação não é válido.</p>`,
        ),
        400,
      );
    }

    const notification = await findOotNotificationByAckToken(token);
    if (!notification) {
      return c.html(
        page(
          "Notificação não encontrada",
          `<h1>Notificação não encontrada</h1><p>Este link de confirmação não corresponde a nenhuma notificação.</p>`,
        ),
        404,
      );
    }

    if (notification.acknowledgedAt) {
      return c.html(alreadyConfirmedPage(notification));
    }

    // First click wins: the stamp is conditional on `acknowledged_at IS NULL`, so
    // of two concurrent clicks only one gets a row back. The other renders the
    // "already confirmed" page, notifies nobody and leaves the first timestamp.
    const stamped = await stampOotAcknowledgementByLink({
      id: notification.id,
      organizationId: notification.organizationId,
      token,
    });
    if (!stamped) {
      return c.html(alreadyConfirmedPage(notification));
    }

    notifyOotAcknowledged(
      notification.id,
      notification.ncId,
      notification.ncNumber,
      notification.organizationId,
    ).catch((err) =>
      console.error("[OOT] Failed to notify acknowledgement:", err),
    );

    return c.html(
      page(
        "Recebimento confirmado",
        `<h1 class="ok">Recebimento confirmado</h1>
<p>Obrigado. O recebimento da notificação <strong>${esc(
          notification.ncNumber,
        )}</strong> foi registrado junto ao laboratório <strong>${esc(
          notification.labName,
        )}</strong>.</p>
<p class="muted">Recomendamos avaliar o impacto nas medições realizadas desde a última calibração válida. O laboratório permanece à disposição para apoiar essa avaliação.</p>`,
      ),
    );
  });
