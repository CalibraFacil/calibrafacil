/** @jsxImportSource react */
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface OrganizationInvitationEmailProps {
  invitedByUsername: string;
  invitedByEmail: string;
  organizationName: string;
  inviteLink: string;
  role: string;
}

export function OrganizationInvitationEmail({
  invitedByUsername = "João",
  invitedByEmail = "joao@example.com",
  organizationName = "Acme Inc.",
  inviteLink = "https://example.com/accept-invitation/123",
  role = "member",
}: OrganizationInvitationEmailProps) {
  const previewText = `Você foi convidado para ${organizationName}`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Convite para Organização</Heading>
          <Text style={paragraph}>Olá,</Text>
          <Text style={paragraph}>
            <strong>{invitedByUsername}</strong> (
            <Link href={`mailto:${invitedByEmail}`} style={link}>
              {invitedByEmail}
            </Link>
            ) convidou você para fazer parte da organização{" "}
            <strong>{organizationName}</strong> como <strong>{role}</strong>.
          </Text>
          <Section style={buttonContainer}>
            <Button style={button} href={inviteLink}>
              Aceitar Convite
            </Button>
          </Section>
          <Text style={paragraph}>
            Ou copie e cole este link no seu navegador:{" "}
            <Link href={inviteLink} style={link}>
              {inviteLink}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={footer}>
            Se você não esperava receber este convite, pode ignorar este e-mail.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default OrganizationInvitationEmail;

const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "20px 0 48px",
  marginBottom: "64px",
  borderRadius: "5px",
};

const heading = {
  fontSize: "24px",
  letterSpacing: "-0.5px",
  lineHeight: "1.3",
  fontWeight: "400",
  color: "#484848",
  padding: "17px 0 0",
  textAlign: "center" as const,
};

const paragraph = {
  margin: "0 0 15px",
  fontSize: "15px",
  lineHeight: "1.4",
  color: "#3c4149",
  padding: "0 40px",
};

const buttonContainer = {
  padding: "27px 0 27px",
  textAlign: "center" as const,
};

const button = {
  backgroundColor: "#18181b",
  borderRadius: "6px",
  fontWeight: "600",
  color: "#fff",
  fontSize: "15px",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const link = {
  color: "#2754C5",
  textDecoration: "underline",
};

const hr = {
  borderColor: "#dfe1e4",
  margin: "42px 40px 26px",
};

const footer = {
  fontSize: "13px",
  lineHeight: "1.4",
  color: "#898989",
  padding: "0 40px",
};
