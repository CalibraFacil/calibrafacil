/** @jsxImportSource react */
import { EmailLayout, StatusBox, styles, theme } from "./components/email-layout";

interface CertificateReadyEmailProps {
  recipientName: string;
  jobId: string;
  assetName?: string;
  customerName?: string;
  portalUrl: string;
}

export function CertificateReadyEmail({
  recipientName = "Usuario",
  jobId = "CAL-2024-0001",
  assetName = "Instrumento",
  customerName,
  portalUrl = "https://portal.calibrafacil.com/certificates",
}: CertificateReadyEmailProps) {
  const previewText = `Certificado de calibracao ${jobId} disponivel para download`;

  return (
    <EmailLayout
      previewText={previewText}
      footerNote="Este certificado foi gerado em conformidade com a ISO/IEC 17025:2017."
    >
      <div style={styles.body}>
        {/* Success Icon Circle */}
        <div
          style={{
            width: "64px",
            height: "64px",
            backgroundColor: theme.colors.successBg,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "24px",
          }}
        >
          <span style={{ fontSize: "32px" }}>{"\u2713"}</span>
        </div>

        <h1 style={styles.title}>Certificado Disponivel</h1>

        <p style={styles.paragraph}>Ola {recipientName},</p>

        <p style={styles.paragraph}>
          O certificado de calibracao esta pronto para download no Portal do
          Cliente.
        </p>

        {/* Job Details Box */}
        <div
          style={{
            backgroundColor: theme.colors.codeBg,
            border: `1px solid ${theme.colors.border}`,
            borderRadius: "8px",
            padding: "24px",
            marginBottom: "24px",
            textAlign: "left" as const,
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <span
              style={{
                display: "block",
                fontSize: "12px",
                color: theme.colors.secondaryText,
                fontWeight: "600",
                textTransform: "uppercase" as const,
                letterSpacing: "0.05em",
                marginBottom: "4px",
              }}
            >
              Ordem de Servico
            </span>
            <span
              style={{
                fontFamily: theme.fontFamily.mono,
                fontSize: "18px",
                color: theme.colors.codeText,
                fontWeight: "700",
              }}
            >
              {jobId}
            </span>
          </div>

          {assetName && (
            <div style={{ marginBottom: customerName ? "16px" : "0" }}>
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: theme.colors.secondaryText,
                  fontWeight: "600",
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                }}
              >
                Instrumento
              </span>
              <span
                style={{
                  fontSize: "16px",
                  color: theme.colors.primaryText,
                  fontWeight: "500",
                }}
              >
                {assetName}
              </span>
            </div>
          )}

          {customerName && (
            <div>
              <span
                style={{
                  display: "block",
                  fontSize: "12px",
                  color: theme.colors.secondaryText,
                  fontWeight: "600",
                  textTransform: "uppercase" as const,
                  letterSpacing: "0.05em",
                  marginBottom: "4px",
                }}
              >
                Cliente
              </span>
              <span
                style={{
                  fontSize: "16px",
                  color: theme.colors.primaryText,
                  fontWeight: "500",
                }}
              >
                {customerName}
              </span>
            </div>
          )}
        </div>

        {/* Success Box */}
        <StatusBox variant="success">
          O certificado esta disponivel para download no Portal do Cliente. Voce
          pode verificar sua autenticidade atraves do QR Code presente no
          documento.
        </StatusBox>

        {/* Action Button */}
        <a href={portalUrl} style={styles.button}>
          Acessar Portal
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
          {portalUrl}
        </p>
      </div>
    </EmailLayout>
  );
}

export default CertificateReadyEmail;
