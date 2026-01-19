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

interface NotificationEmailProps {
  recipientName: string;
  title: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
  footer?: string;
}

export function NotificationEmail({
  recipientName = "Usuário",
  title = "Notificação do CalibraFácil",
  message = "Você tem uma nova notificação.",
  actionUrl,
  actionLabel = "Ver Detalhes",
  footer = "Esta é uma notificação automática do CalibraFácil.",
}: NotificationEmailProps) {
  const previewText = title;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>{title}</Heading>
          <Text style={paragraph}>Olá {recipientName},</Text>
          <Text style={paragraph}>{message}</Text>
          {actionUrl && (
            <Section style={buttonContainer}>
              <Button style={button} href={actionUrl}>
                {actionLabel}
              </Button>
            </Section>
          )}
          {actionUrl && (
            <Text style={paragraph}>
              Ou copie e cole este link no seu navegador:{" "}
              <Link href={actionUrl} style={link}>
                {actionUrl}
              </Link>
            </Text>
          )}
          <Hr style={hr} />
          <Text style={footerStyle}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

export default NotificationEmail;

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

const footerStyle = {
  fontSize: "13px",
  lineHeight: "1.4",
  color: "#898989",
  padding: "0 40px",
};
