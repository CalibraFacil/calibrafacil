/** @jsxImportSource react */
import { EmailLayout, styles, theme } from "./components/email-layout";

interface OrganizationInvitationEmailProps {
  invitedByUsername: string;
  invitedByEmail: string;
  organizationName: string;
  inviteLink: string;
  role: string;
}

const getRoleLabel = (role: string): string => {
  const roleLabels: Record<string, string> = {
    owner: "Proprietario",
    admin: "Administrador",
    member: "Membro",
    technician: "Tecnico",
  };
  return roleLabels[role] || role;
};

export function OrganizationInvitationEmail({
  invitedByUsername = "Joao",
  invitedByEmail = "joao@example.com",
  organizationName = "Acme Inc.",
  inviteLink = "https://example.com/accept-invitation/123",
  role = "member",
}: OrganizationInvitationEmailProps) {
  const previewText = `Voce foi convidado para ${organizationName}`;

  return (
    <EmailLayout previewText={previewText}>
      <div style={styles.body}>
        <h1 style={styles.title}>Convite para Organizacao</h1>

        <p style={styles.paragraph}>Ola,</p>

        <p style={styles.paragraph}>
          <strong>{invitedByUsername}</strong> (
          <a href={`mailto:${invitedByEmail}`} style={styles.link}>
            {invitedByEmail}
          </a>
          ) convidou voce para fazer parte da organizacao{" "}
          <strong>{organizationName}</strong>.
        </p>

        {/* Role Details Box */}
        <div
          style={{
            backgroundColor: theme.colors.codeBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "32px",
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: "12px",
              color: theme.colors.secondaryText,
              fontWeight: "600",
              textTransform: "uppercase" as const,
              letterSpacing: "0.05em",
              marginBottom: "8px",
            }}
          >
            Seu Perfil
          </span>
          <span
            style={{
              fontSize: "20px",
              color: theme.colors.codeText,
              fontWeight: "700",
            }}
          >
            {getRoleLabel(role)}
          </span>
        </div>

        {/* Action Button */}
        <a href={inviteLink} style={styles.button}>
          Aceitar Convite
        </a>

        <p
          style={{
            ...styles.paragraph,
            marginTop: "24px",
            marginBottom: "0",
            fontSize: "13px",
          }}
        >
          Caso o botao nao funcione, copie e cole o link abaixo no navegador:
        </p>
        <p
          style={{
            fontSize: "11px",
            color: "#94a3b8",
            wordBreak: "break-all" as const,
            margin: "8px 0 0",
          }}
        >
          {inviteLink}
        </p>
      </div>

      {/* Security Notice */}
      <div
        style={{
          backgroundColor: theme.colors.warningBg,
          borderTop: `1px solid ${theme.colors.warningBorder}`,
          padding: "16px 32px",
          textAlign: "center" as const,
        }}
      >
        <p
          style={{
            fontSize: "12px",
            color: theme.colors.warningText,
            margin: "0",
            lineHeight: "1.5",
          }}
        >
          <strong>Aviso de seguranca:</strong> Se voce nao esperava receber este
          convite, pode ignorar este email.
        </p>
      </div>
    </EmailLayout>
  );
}

export default OrganizationInvitationEmail;
