import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createLabAuth } from "@calibra-facil/auth";
import { db } from "@calibra-facil/db";
import {
  member,
  organization,
  user as userTable,
} from "@calibra-facil/db/schema";

import {
  authErrorSignals,
  userCreateErrorWasDuplicate,
} from "../lib/auth-user-errors";

/**
 * Everything it takes to turn "a name and an e-mail" into a laboratory that
 * can log in and work.
 *
 * Self-serve sign-up is the only caller today. It does NOT decide *who may
 * call it*: the public route gates on the sign-up e-mail policy, a real MX
 * record and a per-domain cap. Nor does it send the claim e-mail or write the
 * audit entry; those stay at the call site.
 */

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function platformUserFromUnknown(value: unknown) {
  const candidate = recordFromUnknown(value);
  const nested = recordFromUnknown(candidate.user);
  const user = Object.keys(nested).length > 0 ? nested : candidate;
  if (
    typeof user.id !== "string" ||
    typeof user.email !== "string" ||
    typeof user.name !== "string"
  ) {
    throw new HTTPException(502, {
      message: "Auth returned an invalid user payload",
    });
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
  };
}

export function slugifyLabName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function labSlugCandidate(
  input: { name: string; slug?: string },
  suffix: number,
) {
  const baseSlug = slugifyLabName(input.slug ?? input.name) || "laboratorio";
  return suffix === 1 ? baseSlug : `${baseSlug}-${suffix}`;
}

export function labOrganizationCreateErrorWasSlugConflict(error: unknown) {
  // Reads through every shape Better Auth reports a conflict in — a nested
  // `statusCode` or `body` that this missed would abort provisioning on a name
  // collision the next suffix would have resolved.
  const { status, message } = authErrorSignals(error);

  return (
    (status === 409 && (!message || message.includes("slug"))) ||
    (message.includes("slug") &&
      (message.includes("already") ||
        message.includes("duplicate") ||
        message.includes("taken") ||
        message.includes("unique")))
  );
}

/** The identifying fields a laboratory organization is created with. */
export type LabProvisioningOrganization = {
  name: string;
  slug?: string;
  cnpj?: string;
  phone?: string;
  email?: string;
};

export async function createLabOrganizationWithUniqueSlug(input: {
  auth: ReturnType<typeof createLabAuth>;
  lab: LabProvisioningOrganization;
  ownerUserId: string;
  ownerEmail: string;
}) {
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const resolvedSlug = labSlugCandidate(input.lab, attempt);
    // oxlint-disable-next-line no-await-in-loop -- slug candidates must be checked in order.
    const existing = await db.query.organization.findFirst({
      where: eq(organization.slug, resolvedSlug),
    });

    if (existing) {
      continue;
    }

    try {
      // oxlint-disable-next-line no-await-in-loop -- retry the next suffix only after a slug conflict.
      const orgResult = await input.auth.api.createOrganization({
        body: {
          name: input.lab.name,
          slug: resolvedSlug,
          type: "LAB",
          cnpj: input.lab.cnpj ?? "",
          accreditationNumber: "",
          accreditationBody: "",
          street: "",
          number: "",
          complement: "",
          neighbourhood: "",
          city: "",
          state: "",
          cep: "",
          phone: input.lab.phone ?? "",
          email: input.lab.email ?? input.ownerEmail,
          website: "",
          technicalManagerName: "",
          technicalManagerTitle: "",
          userId: input.ownerUserId,
          keepCurrentActiveOrganization: true,
        },
      });
      const org = recordFromUnknown(orgResult);

      if (typeof org.id !== "string") {
        throw new HTTPException(502, {
          message: "Lab auth returned an invalid organization payload",
        });
      }

      return {
        id: org.id,
        slug: resolvedSlug,
      };
    } catch (error) {
      if (!labOrganizationCreateErrorWasSlugConflict(error)) {
        throw error;
      }
    }
  }

  throw new HTTPException(409, {
    message: "Não foi possível gerar um slug disponível para o laboratório",
  });
}

export async function findLabProvisioningUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.query.user.findFirst({
    where: eq(sql<string>`lower(${userTable.email})`, normalizedEmail),
  });

  if (!existing) return null;

  return {
    id: existing.id,
    name: existing.name,
    email: existing.email,
  };
}

export async function ensureLabProvisioningUser(input: {
  name: string;
  email: string;
}) {
  const existing = await findLabProvisioningUser(input.email);

  if (existing) {
    return {
      created: false,
      user: existing,
    };
  }

  const auth = createLabAuth();

  try {
    const createdUser = await auth.api.createUser({
      body: {
        name: input.name,
        email: input.email,
        // Never used: the lab surface has no password sign-in. The account is
        // claimed through a magic link, this only satisfies the admin API.
        password: randomBytes(24).toString("base64url"),
        role: "user",
      },
    });

    return {
      created: true,
      user: platformUserFromUnknown(createdUser),
    };
  } catch (error) {
    if (!userCreateErrorWasDuplicate(error)) {
      throw error;
    }

    const reloaded = await findLabProvisioningUser(input.email);
    if (!reloaded) {
      throw error;
    }

    return {
      created: false,
      user: reloaded,
    };
  }
}

export async function ensureOwnerMembership(input: {
  organizationId: string;
  userId: string;
}) {
  const existing = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId),
    ),
  });

  if (!existing) {
    await db.insert(member).values({
      id: randomBytes(16).toString("hex"),
      organizationId: input.organizationId,
      userId: input.userId,
      role: "owner",
      createdAt: new Date(),
    });
    return "created";
  }

  if (existing.role !== "owner") {
    await db
      .update(member)
      .set({ role: "owner" })
      .where(eq(member.id, existing.id));
    return "promoted";
  }

  return "existing";
}

export async function cleanupFailedLabProvisioning(params: {
  organizationId?: string | null;
}) {
  try {
    if (params.organizationId) {
      await db
        .delete(organization)
        .where(eq(organization.id, params.organizationId));
    }
  } catch (error) {
    console.error("Failed to clean up failed LAB provisioning", {
      organizationId: params.organizationId,
      error,
    });
  }
}

export type ProvisionedLabAccount = {
  organization: { id: string; slug: string; name: string };
  owner: { id: string; name: string; email: string };
  ownerCreated: boolean;
  membershipStatus: "created" | "promoted" | "existing";
};

/**
 * Owner user → organization → owner membership, rolling the organization
 * back if any step after it fails. The caller still owns the claim e-mail and
 * the audit entry.
 */
export async function provisionLabAccount(input: {
  lab: LabProvisioningOrganization;
  owner: { name: string; email: string };
}): Promise<ProvisionedLabAccount> {
  const labAuth = createLabAuth();
  let createdOrganizationId: string | null = null;

  try {
    const owner = await ensureLabProvisioningUser(input.owner);

    const org = await createLabOrganizationWithUniqueSlug({
      auth: labAuth,
      lab: input.lab,
      ownerUserId: owner.user.id,
      ownerEmail: owner.user.email,
    });
    createdOrganizationId = org.id;

    const membershipStatus = await ensureOwnerMembership({
      organizationId: org.id,
      userId: owner.user.id,
    });

    return {
      organization: { id: org.id, slug: org.slug, name: input.lab.name },
      owner: owner.user,
      ownerCreated: owner.created,
      membershipStatus,
    };
  } catch (error) {
    await cleanupFailedLabProvisioning({
      organizationId: createdOrganizationId,
    });
    throw error;
  }
}
