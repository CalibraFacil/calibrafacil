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

interface CertificateReadyEmailProps {
  recipientName: string;
  jobId: string;
  assetName?: string;
  customerName?: string;
  portalUrl: string;
}

export function CertificateReadyEmail({
  recipientName = "Usuário",
  jobId = "CAL-2024-0001",
  assetName = "Instrumento",
  customerName,
  portalUrl = "https://portal.calibrafacil.com/certificates",
}: CertificateReadyEmailProps) {
  const previewText = `Certificado de calibração ${jobId} disponível para download`;

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={heading}>Certificado Disponível</Heading>
          <Text style={paragraph}>Olá {recipientName},</Text>
          <Text style={paragraph}>
            O certificado de calibração da ordem de serviço{" "}
            <strong>{jobId}</strong> está pronto para download.
          </Text>
          {assetName && (
            <Text style={paragraph}>
              <strong>Instrumento:</strong> {assetName}
            </Text>
          )}
          {customerName && (
            <Text style={paragraph}>
              <strong>Cliente:</strong> {customerName}
            </Text>
          )}
          <Section style={buttonContainer}>
            <Button style={button} href={portalUrl}>
              Acessar Portal
            </Button>
          </Section>
          <Text style={paragraph}>
            Você pode baixar o certificado acessando o Portal do Cliente em:{" "}
            <Link href={portalUrl} style={link}>
              {portalUrl}
            </Link>
          </Text>
          <Hr style={hr} />
          <Text style={footerStyle}>
            Este certificado foi gerado em conformidade com a ISO/IEC 17025:2017.
          </Text>
          <Text style={footerStyle}>
            Em caso de dúvidas, entre em contato com o laboratório responsável.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default CertificateReadyEmail;

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
