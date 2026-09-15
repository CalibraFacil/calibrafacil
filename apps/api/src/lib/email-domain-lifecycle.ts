import { db } from "@calibra-facil/db";
import {
  organization,
  organizationEmailDomain,
  organizationEventLog,
} from "@calibra-facil/db/schema";
import {
  createResendDomain,
  deleteResendDomain,
  type ResendFailureClass,
} from "@calibra-facil/email-sender";
import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { buildFromAddress } from "./email-domains";

type Actor = { organizationId: string; userId: string; memberId: string };

export function emailDomainError(
  message: string,
  status: 400 | 409 | 500 | 502,
): never {
  throw new HTTPException(status, {
    res: Response.json({ error: message }, { status }),
  });
}

export function emailProviderError(failureClass: ResendFailureClass): never {
  if (failureClass === "invalid_key") {
    return emailDomainError(
      "O serviço de envio precisa de uma atualização de acesso. Contate o suporte.",
      502,
    );
  }
  if (failureClass === "sender_config") {
    return emailDomainError(
      "Não foi possível configurar este domínio. Confira o nome e contate o suporte se ele já estiver cadastrado em um serviço de envio.",
      400,
    );
  }
  return emailDomainError(
    "Não foi possível concluir a operação no serviço de envio. Aguarde alguns instantes e tente novamente.",
    502,
  );
}

function platformKey(): string {
  return (
    process.env.RESEND_API_KEY ||
    emailDomainError(
      "O serviço de envio ainda não está configurado. Contate o suporte.",
      500,
    )
  );
}

/**
 * Lock the organization, including when no email-domain row exists yet. This
 * serializes create/delete for the same tenant across requests and API workers.
 * A different hostname requires explicit removal first, so we never overwrite
 * the only reference to a managed provider resource.
 */
export async function saveManagedEmailDomain(
  actor: Actor,
  input: { hostname: string; fromLocalPart: string },
) {
  const apiKey = platformKey();
  return db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, actor.organizationId))
      .for("update");
    const existing = await tx.query.organizationEmailDomain.findFirst({
      where: eq(organizationEmailDomain.organizationId, actor.organizationId),
    });
    if (existing) {
      if (existing.mode !== "managed" || existing.hostname !== input.hostname) {
        return emailDomainError(
          "Remova a configuração atual antes de configurar outro domínio.",
          409,
        );
      }
      // Reuse only our own stored ID. Never adopt a provider domain by hostname:
      // it could belong to another tenant or to the platform itself.
      const fromAddress = buildFromAddress(input.fromLocalPart, input.hostname);
      if (existing.fromAddress === fromAddress)
        return { domain: existing, created: false };
      const [updated] = await tx
        .update(organizationEmailDomain)
        .set({
          fromAddress,
          isActive: false,
          activatedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(organizationEmailDomain.id, existing.id))
        .returning();
      await tx.insert(organizationEventLog).values({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorMemberId: actor.memberId,
        action: "email_sender_domain.updated",
        entityType: "email_sender_domain",
        entityId: existing.id,
        details: { hostname: input.hostname, fromAddress },
      });
      return { domain: updated!, created: false };
    }
    const collision = await tx.query.organizationEmailDomain.findFirst({
      where: and(
        eq(organizationEmailDomain.hostname, input.hostname),
        ne(organizationEmailDomain.organizationId, actor.organizationId),
      ),
    });
    if (collision)
      return emailDomainError(
        "Este domínio já está em uso por outra organização",
        409,
      );

    const details = await createResendDomain(apiKey, input.hostname);
    if (!details.ok) return emailProviderError(details.failureClass);
    try {
      const now = new Date();
      const [created] = await tx
        .insert(organizationEmailDomain)
        .values({
          id: crypto.randomUUID(),
          organizationId: actor.organizationId,
          createdBy: actor.userId,
          mode: "managed",
          hostname: input.hostname,
          resendDomainId: details.data.id,
          resendApiKeyEncrypted: null,
          resendApiKeyIv: null,
          resendApiKeyLast4: null,
          fromAddress: buildFromAddress(input.fromLocalPart, input.hostname),
          dnsRecords: details.data.records,
          status: details.data.status,
          verifiedAt: details.data.status === "verified" ? now : null,
          lastVerifiedAt: details.data.status === "verified" ? now : null,
          keyStatus: "ok",
          keyLastError: null,
        })
        .returning();
      await tx.insert(organizationEventLog).values({
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        actorMemberId: actor.memberId,
        action: "email_sender_domain.created",
        entityType: "email_sender_domain",
        entityId: created!.id,
        details: {
          hostname: input.hostname,
          fromAddress: created!.fromAddress,
        },
      });
      return { domain: created!, created: true };
    } catch (error) {
      // Compensate a rejected database write before releasing the tenant lock.
      // Only the ID returned by this create is eligible for cleanup.
      const cleanup = await deleteResendDomain(apiKey, details.data.id);
      if (!cleanup.ok) {
        console.error("[EmailDomain] Provider cleanup required", {
          organizationId: actor.organizationId,
          hostname: input.hostname,
          resendDomainId: details.data.id,
          failureClass: cleanup.failureClass,
        });
      }
      throw error;
    }
  });
}

export async function removeEmailDomain(actor: Actor) {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, actor.organizationId))
      .for("update");
    const record = await tx.query.organizationEmailDomain.findFirst({
      where: eq(organizationEmailDomain.organizationId, actor.organizationId),
    });
    if (!record) return;
    if (record.mode === "managed") {
      const result = await deleteResendDomain(
        platformKey(),
        record.resendDomainId,
      );
      // Keep the row and provider ID on failure so removal can be retried.
      if (!result.ok) return emailProviderError(result.failureClass);
    }
    // Legacy domains belong to the laboratory's account; unlink them only.
    await tx
      .delete(organizationEmailDomain)
      .where(eq(organizationEmailDomain.id, record.id));
    await tx.insert(organizationEventLog).values({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorMemberId: actor.memberId,
      action: "email_sender_domain.deleted",
      entityType: "email_sender_domain",
      entityId: record.id,
      details: {
        hostname: record.hostname,
        wasVerified: Boolean(record.verifiedAt),
        wasActive: record.isActive,
      },
    });
  });
}
