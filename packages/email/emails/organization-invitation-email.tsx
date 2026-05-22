/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  Eyebrow,
  LinkFallback,
  Paragraph,
  StatusBox,
  TextLink,
  Title,
} from "./components/email-layout";

interface OrganizationInvitationEmailProps {
  invitedByUsername: string;
  invitedByEmail: string;
  organizationName: string;
  inviteLink: string;
  role: string;
  logoSrc?: string;
}

const getRoleLabel = (role: string): string => {
  const roleLabels: Record<string, string> = {
    owner: "Proprietário",
    admin: "Administrador",
    member: "Membro",
    operator: "Operador",
    technician: "Técnico",
  };
  return roleLabels[role] || role;
};

export function OrganizationInvitationEmail({
  invitedByUsername = "João",
  invitedByEmail = "joao@example.com",
  organizationName = "Acme Inc.",
  inviteLink = "https://example.com/accept-invitation/123",
  role = "member",
  logoSrc,
}: OrganizationInvitationEmailProps) {
  const previewText = `Você foi convidado para ${organizationName}`;

  return (
    <EmailLayout previewText={previewText} logoSrc={logoSrc}>
      <EmailCard logoSrc={logoSrc}>
        <Eyebrow>Acesso ao workspace</Eyebrow>
        <Title>Convite para organização</Title>

        <Paragraph>Olá,</Paragraph>
        <Paragraph>
          <strong>{invitedByUsername}</strong> (
          <TextLink href={`mailto:${invitedByEmail}`}>
            {invitedByEmail}
          </TextLink>
          ) convidou você para fazer parte da organização{" "}
          <strong>{organizationName}</strong>.
        </Paragraph>

        <DetailBox>
          <DetailRow label="Organização" value={organizationName} />
          <DetailRow label="Perfil" value={getRoleLabel(role)} />
        </DetailBox>

        <ActionButton href={inviteLink}>Aceitar convite</ActionButton>
        <LinkFallback url={inviteLink} />

        <StatusBox variant="warning">
          <strong>Aviso de segurança:</strong> se você não esperava receber este
          convite, pode ignorar este email.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

export default OrganizationInvitationEmail;
