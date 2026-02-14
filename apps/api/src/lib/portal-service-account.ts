import { createLabAuth } from "@calibra-facil/auth";
import {
  INTERNAL_ROLES,
  PORTAL_MANAGEABLE_MEMBER_ROLES,
  isPortalManageableMemberRole,
} from "@calibra-facil/auth/access";
import { db } from "@calibra-facil/db";
import {
  invitation,
  member,
  organization,
  user,
} from "@calibra-facil/db/schema";
import { and, eq, lt, ne, or, SQL } from "drizzle-orm";
import { Resend } from "resend";

const DEFAULT_INVITATION_EXPIRATION_SECONDS = 60 * 60 * 24 * 7; // 7 days

export class PortalServiceAccountError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "PORTAL_SERVICE_ERROR") {
    super(message);
    this.name = "PortalServiceAccountError";
    this.status = status;
    this.code = code;
  }
}

function getPortalServiceUserId(): string {
  const userId = process.env.PORTAL_SERVICE_USER_ID?.trim();
  if (!userId) {
    throw new PortalServiceAccountError(
      "PORTAL_SERVICE_USER_ID nao configurado",
      500,
      "PORTAL_SERVICE_USER_NOT_CONFIGURED",
    );
  }
  return userId;
}

function getInvitationExpirationSeconds(): number {
  const raw = process.env.PORTAL_INVITATION_EXPIRES_IN?.trim();
  if (!raw) return DEFAULT_INVITATION_EXPIRATION_SECONDS;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_INVITATION_EXPIRATION_SECONDS;
  }

  return Math.floor(value);
}

function getPortalAppUrl(): string {
  const explicit = process.env.PORTAL_APP_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }

  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    return appUrl
      .replace(":5173", ":5174")
      .replace("https://calibrafacil.com", "https://portal.calibrafacil.com")
      .replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    return "https://portal.calibrafacil.com";
  }

  return "https://localhost:5174";
}

function getInvitationUrl(invitationId: string): string {
  return `${getPortalAppUrl()}/accept-invite?token=${invitationId}`;
}

async function getPortalServiceUser() {
  const serviceUserId = getPortalServiceUserId();
  const [serviceUser] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, serviceUserId))
    .limit(1);

  if (!serviceUser) {
    throw new PortalServiceAccountError(
      "Usuario de servico do portal nao encontrado",
      500,
      "PORTAL_SERVICE_USER_NOT_FOUND",
    );
  }

  return serviceUser;
}

async function sendPortalInvitationEmail(params: {
  invitationId: string;
  recipientEmail: string;
  organizationName: string;
  role: string;
  inviterName: string;
  inviterEmail: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new PortalServiceAccountError(
      "RESEND_API_KEY nao configurado",
      500,
      "RESEND_NOT_CONFIGURED",
    );
  }

  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.EMAIL_FROM ||
    "Calibra Facil <noreply@calibrafacil.com>";
  const invitationUrl = getInvitationUrl(params.invitationId);

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from,
    to: params.recipientEmail,
    subject: `Convite para ${params.organizationName}`,
    html: `
      <p>Ola,</p>
      <p>Voce recebeu um convite para acessar o portal de <strong>${params.organizationName}</strong>.</p>
      <p>Funcao: <strong>${params.role}</strong></p>
      <p>Convidado por: ${params.inviterName} (${params.inviterEmail})</p>
      <p><a href="${invitationUrl}">Aceitar convite</a></p>
      <p>Se voce nao esperava este convite, ignore este email.</p>
    `,
    text: [
      "Voce recebeu um convite para acessar o portal.",
      `Organizacao: ${params.organizationName}`,
      `Funcao: ${params.role}`,
      `Convidado por: ${params.inviterName} (${params.inviterEmail})`,
      `Aceitar convite: ${invitationUrl}`,
    ].join("\n"),
  });
}

export async function createClientOrganizationAsServiceOwner(params: {
  name: string;
  slug: string;
}) {
  const serviceUser = await getPortalServiceUser();
  const labAuth = createLabAuth();

  const orgResult = await labAuth.api.createOrganization({
    body: {
      name: params.name,
      slug: params.slug,
      type: "CLIENT",
      userId: serviceUser.id,
      keepCurrentActiveOrganization: true,
    },
  });

  if (!orgResult?.id) {
    throw new PortalServiceAccountError(
      "Falha ao criar organizacao do cliente",
      500,
      "CLIENT_ORG_CREATE_FAILED",
    );
  }

  if ((orgResult as { type?: string }).type !== "CLIENT") {
    await db
      .update(organization)
      .set({ type: "CLIENT" })
      .where(eq(organization.id, orgResult.id));
  }

  await enforceClientPortalMembershipBoundary(orgResult.id);

  return orgResult;
}

export async function enforceClientPortalMembershipBoundary(
  organizationId: string,
) {
  const serviceUser = await getPortalServiceUser();

  const [org] = await db
    .select({ id: organization.id, type: organization.type })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (!org || org.type !== "CLIENT") {
    return {
      serviceOwnerAdded: false,
      serviceOwnerPromoted: false,
      removedInternalMembers: 0,
    };
  }

  const [existingServiceMembership] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, serviceUser.id),
      ),
    )
    .limit(1);

  let serviceOwnerAdded = false;
  let serviceOwnerPromoted = false;

  if (!existingServiceMembership) {
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId,
      userId: serviceUser.id,
      role: "owner",
      createdAt: new Date(),
    });
    serviceOwnerAdded = true;
  } else if (existingServiceMembership.role !== "owner") {
    await db
      .update(member)
      .set({ role: "owner" })
      .where(eq(member.id, existingServiceMembership.id));
    serviceOwnerPromoted = true;
  }

  const removableInternalRoleConditions: Array<SQL<unknown>> =
    INTERNAL_ROLES.map((role) => eq(member.role, role));

  const removedMembers = await db
    .delete(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        ne(member.userId, serviceUser.id),
        or(...removableInternalRoleConditions),
      ),
    )
    .returning();

  return {
    serviceOwnerAdded,
    serviceOwnerPromoted,
    removedInternalMembers: removedMembers.length,
  };
}

export async function createPortalInvitationAsService(params: {
  organizationId: string;
  email: string;
  role?: string | null;
}) {
  const serviceUser = await getPortalServiceUser();
  const normalizedEmail = params.email.trim().toLowerCase();
  const role = params.role || PORTAL_MANAGEABLE_MEMBER_ROLES[0];

  if (!isPortalManageableMemberRole(role)) {
    throw new PortalServiceAccountError(
      "Funcao de convite invalida para portal",
      400,
      "INVALID_PORTAL_INVITE_ROLE",
    );
  }

  const [org] = await db
    .select({
      id: organization.id,
      name: organization.name,
      type: organization.type,
    })
    .from(organization)
    .where(eq(organization.id, params.organizationId))
    .limit(1);

  if (!org || org.type !== "CLIENT") {
    throw new PortalServiceAccountError(
      "Organizacao de cliente nao encontrada",
      404,
      "CLIENT_ORG_NOT_FOUND",
    );
  }

  const [existingMember] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(
      and(
        eq(member.organizationId, params.organizationId),
        eq(user.email, normalizedEmail),
      ),
    )
    .limit(1);

  if (existingMember) {
    throw new PortalServiceAccountError(
      "Usuario ja e membro do portal",
      409,
      "PORTAL_USER_ALREADY_MEMBER",
    );
  }

  // Normalize old pending invites that already expired
  await db
    .update(invitation)
    .set({ status: "expired" })
    .where(
      and(
        eq(invitation.organizationId, params.organizationId),
        eq(invitation.email, normalizedEmail),
        eq(invitation.status, "pending"),
        lt(invitation.expiresAt, new Date()),
      ),
    );

  const [pendingInvitation] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        eq(invitation.organizationId, params.organizationId),
        eq(invitation.email, normalizedEmail),
        eq(invitation.status, "pending"),
      ),
    )
    .limit(1);

  if (pendingInvitation) {
    throw new PortalServiceAccountError(
      "Ja existe um convite pendente para este email",
      409,
      "INVITATION_ALREADY_PENDING",
    );
  }

  const invitationId = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + getInvitationExpirationSeconds() * 1000,
  );

  await db.insert(invitation).values({
    id: invitationId,
    organizationId: params.organizationId,
    email: normalizedEmail,
    role,
    status: "pending",
    expiresAt,
    createdAt,
    inviterId: serviceUser.id,
  });

  await sendPortalInvitationEmail({
    invitationId,
    recipientEmail: normalizedEmail,
    organizationName: org.name,
    role,
    inviterName: serviceUser.name,
    inviterEmail: serviceUser.email,
  });

  return {
    id: invitationId,
    email: normalizedEmail,
    role,
    expiresAt,
  };
}

export async function cancelPortalInvitationAsService(params: {
  invitationId: string;
  organizationId: string;
}) {
  const [updated] = await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(
      and(
        eq(invitation.id, params.invitationId),
        eq(invitation.organizationId, params.organizationId),
        eq(invitation.status, "pending"),
      ),
    )
    .returning();

  if (!updated) {
    throw new PortalServiceAccountError(
      "Convite nao encontrado ou ja finalizado",
      400,
      "INVITATION_NOT_PENDING",
    );
  }

  return updated;
}

export async function removePortalMemberAsService(params: {
  memberId: string;
  organizationId: string;
}) {
  const [deleted] = await db
    .delete(member)
    .where(
      and(
        eq(member.id, params.memberId),
        eq(member.organizationId, params.organizationId),
      ),
    )
    .returning();

  if (!deleted) {
    throw new PortalServiceAccountError(
      "Membro nao encontrado",
      404,
      "MEMBER_NOT_FOUND",
    );
  }

  return deleted;
}
