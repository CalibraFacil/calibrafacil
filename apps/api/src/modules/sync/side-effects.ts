import { type SyncCommand } from "@calibra-facil/contracts";
import { CreateCustomerSchema } from "@calibra-facil/schemas";
import { type MemberData } from "../../middleware/permission";
import { type R2Env } from "../../lib/storage";
import { prepareCreateLocalAttachment } from "./apply-attachment";
import { asRecord } from "./helpers";
import {
  desktopCustomerOrganizationMetadata,
  desktopCustomerSlug,
  findOrganizationCreatedForEvent,
} from "./desktop-customer-org";
import { createClientOrganizationAsServiceOwner } from "../../lib/portal-service-account";
import { type PreparedDesktopEventSideEffects } from "./desktop-event-support";
import {
  findAppliedDesktopSyncEvent,
  findDesktopSyncRemoteEntityId,
} from "./desktop-sync-support";

export async function prepareDesktopEventSideEffects(
  command: SyncCommand,
  memberData: MemberData,
  context: { env: R2Env | undefined; protocolVersion: number },
): Promise<PreparedDesktopEventSideEffects> {
  if (command.operation === "create_local_attachment") {
    return prepareCreateLocalAttachment(command, memberData, context);
  }
  if (command.operation !== "create_local_customer") return {};

  // Already applied (a retried push): the transaction answers from its record.
  if (
    (await findDesktopSyncRemoteEntityId(
      memberData.organizationId,
      command.entityId,
    )) !== null ||
    (await findAppliedDesktopSyncEvent(memberData.organizationId, command))
  ) {
    return {};
  }
  const parsed = CreateCustomerSchema.safeParse(asRecord(command.payload));
  // The apply refuses an invalid payload with its own code.
  if (!parsed.success) return {};

  const slug = desktopCustomerSlug(
    parsed.data.name,
    memberData.organizationId,
    command.eventId,
  );
  const foreign: PreparedDesktopEventSideEffects = {
    refusal: {
      code: "DOMAIN_VALIDATION_FAILED",
      reason:
        "Ja existe uma organizacao com o identificador reservado para este cliente e ela nao foi criada por este evento deste laboratorio; o cliente nao foi criado.",
    },
  };
  const existing = await findOrganizationCreatedForEvent(
    slug,
    memberData.organizationId,
    command.eventId,
  );
  if (existing.state === "foreign") return foreign;
  if (existing.state === "ours") return { clientOrganizationId: existing.id };

  try {
    const created = await createClientOrganizationAsServiceOwner({
      name: parsed.data.name,
      slug,
      metadata: desktopCustomerOrganizationMetadata(
        memberData.organizationId,
        command.eventId,
      ),
    });
    return { clientOrganizationId: created.id };
  } catch (error) {
    // A concurrent push of this event created it first.
    const raced = await findOrganizationCreatedForEvent(
      slug,
      memberData.organizationId,
      command.eventId,
    );
    if (raced.state === "ours") return { clientOrganizationId: raced.id };
    if (raced.state === "foreign") return foreign;
    throw error;
  }
}
