/** @jsxRuntime automatic */
/** @jsxImportSource react */
import {
  DetailBox,
  DetailRow,
  EmailLayout,
  Paragraph,
  Title,
} from "./components/email-layout";

interface NewLeadEmailProps {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  segment: string;
  message?: string;
  utmSource?: string;
  utmCampaign?: string;
  referrer?: string;
  submittedAt: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  lab: "Laboratório de calibração",
  oficina: "Oficina permissionária do Inmetro",
  outro: "Outro / não informado",
};

// Internal (team-facing) notification for a new marketing-site lead. Not
// white-labeled — this always goes to the CalibraFácil sales inbox.
export function NewLeadEmail({
  name,
  email,
  phone,
  company,
  segment,
  message,
  utmSource,
  utmCampaign,
  referrer,
  submittedAt,
}: NewLeadEmailProps) {
  const hasAttribution = Boolean(utmSource || utmCampaign || referrer);

  return (
    <EmailLayout
      previewText={`Novo lead: ${name}${company ? ` — ${company}` : ""}`}
      footerNote="Notificação interna — lead recebido pelo formulário do site."
    >
      <Title>Novo lead pelo site</Title>
      <Paragraph>
        Um visitante solicitou contato pelo formulário do site. Responda
        diretamente a este e-mail para falar com o interessado.
      </Paragraph>

      <DetailBox>
        <DetailRow label="Nome" value={name} />
        <DetailRow label="E-mail" value={email} />
        {phone ? <DetailRow label="Telefone / WhatsApp" value={phone} /> : null}
        {company ? <DetailRow label="Empresa" value={company} /> : null}
        <DetailRow label="Perfil" value={SEGMENT_LABELS[segment] ?? segment} />
        <DetailRow label="Recebido em" value={submittedAt} />
      </DetailBox>

      {message ? (
        <DetailBox>
          <DetailRow label="Mensagem" value={message} />
        </DetailBox>
      ) : null}

      {hasAttribution ? (
        <DetailBox>
          {utmSource ? (
            <DetailRow label="Origem (utm_source)" value={utmSource} />
          ) : null}
          {utmCampaign ? (
            <DetailRow label="Campanha (utm_campaign)" value={utmCampaign} />
          ) : null}
          {referrer ? <DetailRow label="Referrer" value={referrer} /> : null}
        </DetailBox>
      ) : null}
    </EmailLayout>
  );
}
