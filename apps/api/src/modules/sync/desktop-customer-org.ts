import { createHash } from "node:crypto";
import { db } from "@calibra-facil/db";
import { customer, organization } from "@calibra-facil/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { asRecord } from "./helpers";

// The pre-phase of a legacy `create_local_customer` event (see
// PreparedDesktopEventSideEffects in modules/sync/desktop-event-support.ts): the client organization it
// creates is found again by a deterministic slug, and adopted only when it
// verifiably belongs to this laboratory and event.

/**
 * The slug of the client organization a `create_local_customer` event creates:
 * the customer's name (30 characters at most) plus the SHA-256 of the
 * laboratory and the event id, 128 bits of it, so the same event always finds
 * the organization it created before (a retry after a rolled-back transaction
 * reuses it instead of creating a second one) and nobody can grind a colliding
 * digest. At most 63 characters. Knowing a slug is NOT a claim on the
 * organization: see `findOrganizationCreatedForEvent`.
 */
export function desktopCustomerSlug(
  name: string,
  laboratoryId: string,
  eventId: string,
) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 30)
    .replace(/-+$/g, "");
  const digest = createHash("sha256")
    .update(`${laboratoryId}:${eventId}`)
    .digest("hex")
    .slice(0, 32);

  return `${base || "cliente"}-${digest}`;
}

/** What the pre-phase stamps on the organization it creates (better-auth `metadata`). */
export function desktopCustomerOrganizationMetadata(
  laboratoryId: string,
  eventId: string,
) {
  return { desktopSync: { laboratoryId, eventId } };
}

export type ExistingEventOrganization =
  | { state: "none" }
  | { state: "ours"; id: string }
  | { state: "foreign" };

/**
 * The organization this very event created for this laboratory, if one exists.
 * A slug that merely matches proves nothing (it is visible to whoever can read
 * the customer), so an organization is adopted only when it is a CLIENT
 * organization stamped with this laboratory AND this event, and no customer of
 * another laboratory references it. Anything else with that slug is `foreign`.
 */
export async function findOrganizationCreatedForEvent(
  slug: string,
  laboratoryId: string,
  eventId: string,
): Promise<ExistingEventOrganization> {
  // Cross-organization by design: `organization` is the auth table, global, and
  // a slug is not a claim on a row; the stamp below is the proof of ownership.
  const [existing] = await db
    .select({
      id: organization.id,
      type: organization.type,
      metadata: organization.metadata,
    })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (!existing) return { state: "none" };
  if (existing.type !== "CLIENT") return { state: "foreign" };

  const stamp = readDesktopCustomerOrganizationStamp(existing.metadata);
  if (stamp?.laboratoryId !== laboratoryId || stamp.eventId !== eventId) {
    return { state: "foreign" };
  }

  // Cross-laboratory by design: is any OTHER laboratory's customer attached to
  // this organization? A handle bound to this laboratory could never see it.
  const [otherLaboratory] = await db
    .select({ id: customer.id })
    .from(customer)
    .where(
      and(
        eq(customer.authOrganizationId, existing.id),
        ne(customer.labOrganizationId, laboratoryId),
      ),
    )
    .limit(1);
  return otherLaboratory
    ? { state: "foreign" }
    : { state: "ours", id: existing.id };
}

function readDesktopCustomerOrganizationStamp(metadata: string | null) {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    const stamp = asRecord(asRecord(parsed).desktopSync);
    return typeof stamp.laboratoryId === "string" &&
      typeof stamp.eventId === "string"
      ? { laboratoryId: stamp.laboratoryId, eventId: stamp.eventId }
      : null;
  } catch {
    return null;
  }
}
