/** @jsxRuntime automatic */
/** @jsxImportSource react */
import type { ReactNode } from "react";
import {
  SERVICE_ORDER_STATUS,
  SERVICE_ORDER_STATUSES,
  type ServiceOrderStatus,
} from "@calibra-facil/shared/service-orders";
import {
  ServiceOrderEmailLayout,
  ServiceOrderStatusBadge,
  ServiceOrderStatusRow,
} from "./service-order-email-layout";
import {
  DetailBox,
  DetailRow,
  EmailCard,
  emailBrandName,
  Paragraph,
  Title,
  type EmailBrand,
} from "./components/email-layout";

/** What a status' copy may mention. */
interface StatusEmailContext {
  labName: string;
  customerName: string;
  serviceOrderNumber: string;
  /** The label every other screen shows for the status (the vocabulary's). */
  statusLabel: string;
}

/** The words of one customer-facing status email; the frame is shared. */
interface ServiceOrderStatusEmailCopy {
  /** The REQ-SOEMAIL requirement this email implements. */
  readonly req: string;
  /** Subject line of the sent message. */
  subject: (serviceOrderNumber: string) => string;
  /** Pre-header shown by the mail client. */
  previewText: (context: StatusEmailContext) => string;
  /** Wording of the pill above the headline (its colour is the status' tone). */
  badge: string;
  title: (context: StatusEmailContext) => ReactNode;
  /** Paragraph(s) above the detail box. */
  intro: (context: StatusEmailContext) => ReactNode;
  /** Label of the status row of the detail box; "Status" when absent. */
  detailLabel?: string;
  /** Paragraph(s) below the detail box. */
  outro: (context: StatusEmailContext) => ReactNode;
}

/** The words the two calibration stages share. */
const STAGE_UPDATE = {
  req: "REQ-SOEMAIL-042",
  subject: (n) => `OS ${n} — atualização do serviço`,
  previewText: ({ serviceOrderNumber, statusLabel }) =>
    `OS ${serviceOrderNumber} — ${statusLabel.toLowerCase()}.`,
  badge: "Atualização do serviço",
  title: ({ statusLabel }) => <>Atualização: {statusLabel}</>,
  intro: ({ customerName, labName }) => (
    <Paragraph>
      Olá, {customerName}! {labName} tem uma atualização sobre a sua ordem de
      serviço.
    </Paragraph>
  ),
  detailLabel: "Etapa atual",
} satisfies Omit<ServiceOrderStatusEmailCopy, "outro">;

function StageUpdateClosing({ labName }: { labName: string }) {
  return (
    <Paragraph>
      Informaremos você quando houver mais novidades. Obrigado pela paciência e
      pela confiança em {labName}!
    </Paragraph>
  );
}

/**
 * The email each service-order status sends, keyed by status. A status with
 * `null` sends no status email (its mail is a different template: the order's
 * creation, the quote). `satisfies Record<ServiceOrderStatus, …>` makes a new
 * status fail to compile until someone decides which of the two it is.
 */
const STATUS_EMAIL_COPY = {
  // Sent by the service-order-created and quote emails, not by this template.
  opened: null,
  awaiting_quote_approval: null,
  quote_approved: null,
  quote_rejected: null,

  awaiting_tech_evaluation: {
    req: "REQ-SOEMAIL-043",
    subject: (n) => `OS ${n} — aguardando avaliação técnica`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — aguardando avaliação técnica.`,
    badge: "Aguardando avaliação",
    title: () => "Equipamento aguarda avaliação técnica",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! Seu equipamento na ordem de serviço{" "}
        {serviceOrderNumber} está aguardando avaliação técnica pela equipe
        especializada de {labName}.
      </Paragraph>
    ),
    outro: () => (
      <Paragraph>
        Em breve nossa equipe técnica realizará a avaliação e informaremos você
        sobre os próximos passos. Obrigado pela paciência!
      </Paragraph>
    ),
  },
  under_evaluation: {
    req: "REQ-SOEMAIL-044",
    subject: (n) => `OS ${n} — em avaliação técnica`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — em avaliação técnica.`,
    badge: "Em avaliação técnica",
    title: () => "Avaliação técnica em andamento",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! A equipe técnica de {labName} está realizando a
        avaliação do equipamento da ordem de serviço {serviceOrderNumber}.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Assim que a avaliação for concluída, informaremos você sobre os
        resultados e os próximos passos. Obrigado pela confiança em {labName}!
      </Paragraph>
    ),
  },
  repair_in_progress: {
    req: "REQ-SOEMAIL-041",
    subject: (n) => `OS ${n} — serviço iniciado`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — serviço iniciado pelo laboratório.`,
    badge: "Serviço iniciado",
    title: () => "Serviço em andamento",
    intro: ({ customerName, labName }) => (
      <Paragraph>
        Olá, {customerName}! {labName} iniciou a execução do serviço na sua
        ordem de serviço. Nossa equipe técnica está trabalhando no seu
        equipamento.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Entraremos em contato quando o serviço for concluído. Obrigado pela
        confiança em {labName}!
      </Paragraph>
    ),
  },
  // awaiting_calibration and calibration_in_progress share the frame of the
  // stage update; only the stage sentence differs.
  awaiting_calibration: {
    ...STAGE_UPDATE,
    outro: ({ labName }) => (
      <>
        <Paragraph>
          O serviço técnico foi concluído e o equipamento aguarda o processo de
          calibração.
        </Paragraph>
        <StageUpdateClosing labName={labName} />
      </>
    ),
  },
  calibration_in_progress: {
    ...STAGE_UPDATE,
    outro: ({ labName }) => (
      <>
        <Paragraph>
          O equipamento está sendo submetido ao processo de calibração pela
          equipe especializada.
        </Paragraph>
        <StageUpdateClosing labName={labName} />
      </>
    ),
  },
  awaiting_final_review: {
    req: "REQ-SOEMAIL-054",
    subject: (n) => `OS ${n} — em revisão final`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — em revisão final.`,
    badge: "Em revisão final",
    title: () => "Serviço em revisão final",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! O serviço da ordem de serviço {serviceOrderNumber}{" "}
        está passando pela etapa de revisão final em {labName}.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Estamos quase concluindo! Em breve você será notificado sobre a
        disponibilidade do equipamento. Obrigado pela paciência e pela confiança
        em {labName}!
      </Paragraph>
    ),
  },
  ready_for_pickup: {
    req: "REQ-SOEMAIL-051",
    subject: (n) => `OS ${n} — pronto para retirada`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — pronto para retirada.`,
    badge: "Pronto para retirada",
    title: () => "Seu equipamento está pronto para retirada",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! O serviço da sua ordem de serviço{" "}
        {serviceOrderNumber} foi concluído e o equipamento está pronto para
        retirada em {labName}.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Por favor, entre em contato com {labName} para combinar a retirada do
        equipamento. Obrigado pela confiança!
      </Paragraph>
    ),
  },
  delivered: {
    req: "REQ-SOEMAIL-052",
    subject: (n) => `OS ${n} — equipamento entregue`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — equipamento entregue.`,
    badge: "Equipamento entregue",
    title: () => "Confirmação de entrega",
    intro: ({ customerName, serviceOrderNumber }) => (
      <Paragraph>
        Olá, {customerName}! Confirmamos que o equipamento da ordem de serviço{" "}
        {serviceOrderNumber} foi entregue com sucesso. Este é o seu comprovante
        de entrega.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Agradecemos pela confiança em {labName}. Se precisar de qualquer
        assistência adicional, não hesite em nos contatar.
      </Paragraph>
    ),
  },
  closed: {
    req: "REQ-SOEMAIL-053",
    subject: (n) => `OS ${n} — OS encerrada`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — ordem de serviço encerrada.`,
    badge: "OS encerrada",
    title: () => "Ordem de serviço encerrada",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! A ordem de serviço {serviceOrderNumber} foi
        formalmente encerrada por {labName}.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Obrigado por escolher {labName}. Estamos à disposição para atendê-lo em
        futuras necessidades.
      </Paragraph>
    ),
  },
  canceled: {
    req: "REQ-SOEMAIL-061",
    subject: (n) => `OS ${n} — OS cancelada`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — ordem de serviço cancelada.`,
    badge: "OS cancelada",
    title: () => "Ordem de serviço cancelada",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! Informamos que a ordem de serviço{" "}
        {serviceOrderNumber} foi cancelada por {labName}.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Se você tiver dúvidas sobre o cancelamento, entre em contato com{" "}
        {labName}. Agradecemos a sua compreensão.
      </Paragraph>
    ),
  },
  warranty_return: {
    req: "REQ-SOEMAIL-062",
    subject: (n) => `OS ${n} — retorno em garantia`,
    previewText: ({ serviceOrderNumber }) =>
      `OS ${serviceOrderNumber} — retorno em garantia.`,
    badge: "Retorno em garantia",
    title: () => "Ordem de serviço em retorno de garantia",
    intro: ({ customerName, serviceOrderNumber, labName }) => (
      <Paragraph>
        Olá, {customerName}! Informamos que a ordem de serviço{" "}
        {serviceOrderNumber} entrou no processo de retorno em garantia em{" "}
        {labName}.
      </Paragraph>
    ),
    outro: ({ labName }) => (
      <Paragraph>
        Nossa equipe irá avaliar o equipamento e entrar em contato com você em
        breve. Se tiver dúvidas, entre em contato com {labName}.
      </Paragraph>
    ),
  },
} satisfies Record<ServiceOrderStatus, ServiceOrderStatusEmailCopy | null>;

/** The statuses that send a status email: the keys whose copy is not `null`. */
export type ServiceOrderEmailStatus = {
  [S in keyof typeof STATUS_EMAIL_COPY]: (typeof STATUS_EMAIL_COPY)[S] extends null
    ? never
    : S;
}[keyof typeof STATUS_EMAIL_COPY];

function copyFor(status: ServiceOrderEmailStatus): ServiceOrderStatusEmailCopy {
  const copy: ServiceOrderStatusEmailCopy | null = STATUS_EMAIL_COPY[status];
  if (copy === null) {
    throw new Error(`Service-order status "${status}" sends no status email`);
  }
  return copy;
}

/** Type guard: does this service-order status send a status email? */
export function sendsServiceOrderStatusEmail(
  status: ServiceOrderStatus,
): status is ServiceOrderEmailStatus {
  return STATUS_EMAIL_COPY[status] !== null;
}

/** Every status that sends a status email, in the vocabulary's order. */
export const SERVICE_ORDER_EMAIL_STATUSES: readonly ServiceOrderEmailStatus[] =
  SERVICE_ORDER_STATUSES.filter(sendsServiceOrderStatusEmail);

/** The REQ-SOEMAIL requirement a status email implements. */
export function serviceOrderStatusEmailRequirement(
  status: ServiceOrderEmailStatus,
): string {
  return copyFor(status).req;
}

/** Subject line of the status email for `status`. */
export function serviceOrderStatusEmailSubject(
  status: ServiceOrderEmailStatus,
  serviceOrderNumber: string,
): string {
  return copyFor(status).subject(serviceOrderNumber);
}

export interface ServiceOrderStatusEmailProps {
  /** The status the service order entered; picks the copy. */
  status: ServiceOrderEmailStatus;
  /** White-label brand for the sending lab. */
  brand?: EmailBrand;
  /** OS number, e.g. "OS-2026-042". */
  serviceOrderNumber: string;
  /** Customer name. */
  customerName: string;
}

/**
 * Customer-facing email for a service order that entered `status`
 * (REQ-SOEMAIL-041..062). One frame, the words per status from the table
 * above; the status row shows the vocabulary's label.
 */
export function ServiceOrderStatusEmail({
  status,
  brand,
  serviceOrderNumber,
  customerName,
}: ServiceOrderStatusEmailProps) {
  const copy = copyFor(status);
  const context: StatusEmailContext = {
    labName: emailBrandName(brand),
    customerName,
    serviceOrderNumber,
    statusLabel: SERVICE_ORDER_STATUS.label(status),
  };

  return (
    <ServiceOrderEmailLayout
      previewText={copy.previewText(context)}
      brand={brand}
    >
      <EmailCard brand={brand}>
        <ServiceOrderStatusBadge status={status}>
          {copy.badge}
        </ServiceOrderStatusBadge>
        <Title>{copy.title(context)}</Title>
        {copy.intro(context)}

        <DetailBox>
          <DetailRow label="Número da OS" value={serviceOrderNumber} />
          {copy.detailLabel === undefined ? (
            <ServiceOrderStatusRow status={status} />
          ) : (
            <DetailRow label={copy.detailLabel} value={context.statusLabel} />
          )}
        </DetailBox>

        {copy.outro(context)}
      </EmailCard>
    </ServiceOrderEmailLayout>
  );
}

ServiceOrderStatusEmail.PreviewProps = {
  status: "awaiting_tech_evaluation",
  serviceOrderNumber: "OS-2026-042",
  customerName: "Maria Silva",
} satisfies ServiceOrderStatusEmailProps;

export default ServiceOrderStatusEmail;
