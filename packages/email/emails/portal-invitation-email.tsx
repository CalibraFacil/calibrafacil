/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  ActionButton,
  DetailBox,
  DetailRow,
  EmailCard,
  EmailLayout,
  LinkFallback,
  Paragraph,
  StatusBox,
  Title,
  type EmailBrand,
} from "./components/email-layout";

interface PortalInvitationEmailProps {
  recipientName?: string;
  organizationName: string;
  labName?: string | null;
  role?: string;
  inviteUrl: string;
  logoSrc?: string;
  brand?: EmailBrand;
}

export function PortalInvitationEmail({
  recipientName = "usuário",
  organizationName = "Cliente",
  labName,
  role = "viewer",
  inviteUrl = "https://calibrafacil.com/portal/accept-invite",
  logoSrc,
  brand,
}: PortalInvitationEmailProps) {
  return (
    <EmailLayout
      previewText={`Convite para ${organizationName}`}
      logoSrc={logoSrc}
      brand={brand}
    >
      <EmailCard logoSrc={logoSrc} brand={brand}>
        <Title>Acesse o portal do cliente</Title>

        <Paragraph>Olá, {recipientName},</Paragraph>
        <Paragraph>
          Você recebeu um convite para acessar{" "}
          <strong>{organizationName}</strong> no Portal CalibraFácil.
        </Paragraph>
        {labName && (
          <Paragraph>
            Este convite foi enviado pelo laboratório <strong>{labName}</strong>
            .
          </Paragraph>
        )}

        <DetailBox>
          {labName && <DetailRow label="Laboratório" value={labName} />}
          <DetailRow label="Cliente" value={organizationName} />
          <DetailRow label="Perfil" value={role} />
        </DetailBox>

        <ActionButton href={inviteUrl}>Aceitar convite</ActionButton>
        <LinkFallback url={inviteUrl} />

        <StatusBox variant="info">
          Este link expira em poucos minutos. Se você não esperava este convite,
          pode ignorar esta mensagem.
        </StatusBox>
      </EmailCard>
    </EmailLayout>
  );
}

PortalInvitationEmail.PreviewProps = {
  recipientName: "Ana",
  organizationName: "ACME Laboratórios",
  labName: "CalibraFácil Metrologia",
  role: "viewer",
  inviteUrl: "https://calibrafacil.com/portal/accept-invite?token=abc",
} satisfies PortalInvitationEmailProps;

export default PortalInvitationEmail;
