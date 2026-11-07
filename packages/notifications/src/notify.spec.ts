/**
 * notify(type, payload): the one path every notification takes, and the
 * recipes behind it (recipes/*.ts).
 *
 * What is pinned here is what each of the notifyXxx entry points delivers:
 * for a fixed set of database rows, the in-app rows inserted (recipient,
 * organization, type, priority, title, message, link) and how many e-mails go
 * out. The expected rows are what the hand-written notifyXxx functions
 * produced before they became a table of recipes, so a changed word, a lost
 * recipient or a different "do not notify the actor" rule goes red here.
 *
 * The database is a fake that answers each select by the names of the columns
 * asked for, so no real infrastructure is needed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_TYPES } from "@calibra-facil/schemas";

// A fixed "now": the due dates below count days from it.
const NOW = new Date("2026-06-10T12:00:00Z");
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);

type Insert = Record<string, unknown>;
const recorded = vi.hoisted(() => ({
  inserts: Array.of<Insert>(),
  emails: Array.of<unknown>(),
  nextId: 100,
}));
const fakeDb = vi.hoisted(() => ({
  select: (_fields?: Record<string, unknown>): unknown => undefined,
  insert: (_table: unknown): unknown => undefined,
  update: (_table: unknown): unknown => undefined,
}));

/** What every column the code asks for holds. */
const COLUMN_VALUES: Record<string, unknown> = {
  id: 7,
  organizationId: "org-lab",
  authOrganizationId: "org-client",
  technicianId: "tech-1",
  scheduledAt: day(20),
  sourceRequestId: 42,
  address: {
    street: "Rua A",
    number: "1",
    complement: "ap 2",
    neighbourhood: "Centro",
    city: "POA",
    state: "RS",
    cep: "90000-000",
  },
  customerName: "ACME",
  labName: "Lab Acme",
  technicianName: "João",
  requestSubmittedBy: "cust-1",
  requestAuthOrganizationId: "org-client",
  jobIdentifier: "OS-100",
  customerId: 5,
  assetId: 9,
  createdBy: "creator-1",
  submittedBy: "cust-1",
  requestedDueDate: day(20),
  name: "Nome",
  tag: "TAG1",
  manufacturer: "Fab",
  model: "Mod",
  serialNumber: "SN1",
  nextCalibrationDate: day(20),
  metrologyRegime: "LEGAL",
  nextLegalVerificationDate: day(20),
  regulatedInterval: {
    operationalizedByDelegate: true,
    regulationReference: "Portaria 1",
  },
  certificateNumber: "CERT1",
  scopePart: "Massa",
  nextDueAt: day(20),
  validUntil: day(20),
  unitName: "Unidade A",
  quantityKind: "mass",
  rangeMin: 0,
  rangeMax: 100,
  rangeUnit: "g",
  description: "desc",
  dueDate: day(20),
  status: "IN_PROGRESS",
  userId: "tech-1",
  scopeDescription: "Escopo X",
  expiresAt: day(20),
  assetTypeId: 1,
  requestedBy: "cust-1",
  params: { dateFrom: "2026-01-01", dateTo: "2026-03-31" },
  certificateCount: 3,
  labOrganizationId: "org-lab",
  email: "u@x.com",
  logo: "http://logo",
  cnpj: "12.345",
  accreditationNumber: "CRL 1",
  accreditationBody: "Cgcre",
  street: "Rua L",
  number: "9",
  complement: null,
  neighbourhood: "Bairro",
  city: "POA",
  state: "RS",
  cep: "91000-000",
  phone: "5133",
  website: "http://lab",
};

function rowsFor(fields: Record<string, unknown> | undefined) {
  // notification_preference: no row, so the registry's defaults apply.
  if (!fields) return [];
  const keys = Object.keys(fields);
  // Members of an organization: two of them.
  if (keys.length === 1 && keys[0] === "userId") {
    return [{ userId: "u1" }, { userId: "u2" }];
  }
  // The items of a calibration request: two.
  if (keys.length === 1 && keys[0] === "id") return [{ id: 1 }, { id: 2 }];
  return [Object.fromEntries(keys.map((key) => [key, COLUMN_VALUES[key]]))];
}

/** A query builder every method of which returns itself and which can be awaited. */
function queryResolvingTo(rows: unknown[]) {
  const query = {
    from: () => query,
    where: () => query,
    innerJoin: () => query,
    leftJoin: () => query,
    orderBy: () => query,
    limit: () => query,
    // oxlint-disable-next-line unicorn/no-thenable -- stands in for a drizzle query, which is awaited
    then: (
      resolve: (rows: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return query;
}

fakeDb.select = (fields) => queryResolvingTo(rowsFor(fields));
fakeDb.insert = () => {
  const insert = {
    values: (values: Insert) => {
      recorded.inserts.push(values);
      return insert;
    },
    returning: () => Promise.resolve([{ id: ++recorded.nextId }]),
  };
  return insert;
};
fakeDb.update = () => {
  const update = { set: () => update, where: () => Promise.resolve([]) };
  return update;
};

vi.mock("@calibra-facil/db", () => ({ db: fakeDb, systemDb: fakeDb }));
// Every organization-scoped transaction runs on the fake; the laboratory of an
// entity id is always "org-lab".
vi.mock("./lab-scope", () => ({
  inOrg: (_organizationId: string, run: (tx: unknown) => unknown) =>
    run(fakeDb),
  findVisitLaboratory: async () => "org-lab",
  findJobLaboratory: async () => "org-lab",
  findCalibrationRequestLaboratory: async () => "org-lab",
  findAuditPackLaboratory: async () => "org-lab",
  listPortalDigestRecipients: vi.fn(),
}));
vi.mock("@calibra-facil/lab-email-domain", () => ({
  labEmailSenderResolver: {},
  resolveLabEmailSender: async () => undefined,
}));
vi.mock("./suppression", () => ({ isEmailSuppressed: async () => false }));
vi.mock("@calibra-facil/email-sender", () => ({
  formatFromEmail: (from: string) => from,
  formatLabFromHeader: (name: string, address: string) => `${name}<${address}>`,
  getPlatformFromEmail: () => "no-reply@x.test",
  getReplyToEmail: () => undefined,
  isPlatformEmailConfigured: () => true,
  sendEmailWithLabSender: async (input: {
    buildPayload: (sender: undefined) => Promise<unknown>;
  }) => {
    recorded.emails.push(await input.buildPayload(undefined));
    return { sent: true };
  },
  sendPlatformEmail: vi.fn(),
  stripBrandSender: (brand: unknown) => brand,
}));

import {
  notify,
  notifyAccreditationExpiring,
  notifyAccreditedScopeLineExpiring,
  notifyAssetDueForLegalVerification,
  notifyAssetDueForRecalibration,
  notifyAssetFoundOutOfTolerance,
  notifyAuditChainBroken,
  notifyAuditPackReady,
  notifyCalibrationRequestApproved,
  notifyCalibrationRequestConverted,
  notifyCalibrationRequestRejected,
  notifyCalibrationRequestSubmitted,
  notifyCalibrationRequestUnderReview,
  notifyCertificateAmended,
  notifyCertificateReady,
  notifyCompetenceApproved,
  notifyCompetenceExpired,
  notifyCompetenceExpiring,
  notifyCompetenceRequested,
  notifyJobApproved,
  notifyJobAssigned,
  notifyJobOverdue,
  notifyJobRejected,
  notifyJobSubmittedForReview,
  notifyNCCreated,
  notifyNCEscalatedToCapa,
  notifyOotAcknowledged,
  notifyPtPlanDue,
  notifySigningCertificateExpiring,
  notifySigningCertificateLapsed,
  notifyStandardExpired,
  notifyStandardExpiring,
  notifyVisitCancelled,
  notifyVisitConfirmed,
  notifyVisitCustomerConfirmed,
  notifyVisitRescheduleDeclined,
  notifyVisitRescheduleRequested,
  notifyVisitRescheduled,
  notifyVisitReminder,
  notifyVisitScheduled,
} from "./service";
import { NOTIFICATION_RECIPES } from "./recipes";

interface ExpectedRow {
  to: string[];
  type: string;
  organizationId: string;
  priority: string;
  title: string;
  message: string;
  relatedEntity?: Record<string, unknown>;
  actionUrl?: string;
}

const CASES: readonly {
  run: () => Promise<void>;
  /** E-mails sent (the recipients whose preferences leave e-mail on). */
  emails: number;
  rows: readonly ExpectedRow[];
}[] = [
  {
    run: () => notifyJobSubmittedForReview(7, "u1"),
    emails: 1,
    rows: [
      {
        to: ["u2"],
        type: "JOB_SUBMITTED_FOR_REVIEW",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Calibração aguardando revisão",
        message: "Nome submeteu a OS OS-100 para revisão.",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/7",
      },
    ],
  },
  {
    run: () => notifyJobSubmittedForReview(7, "x"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "JOB_SUBMITTED_FOR_REVIEW",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Calibração aguardando revisão",
        message: "Nome submeteu a OS OS-100 para revisão.",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/7",
      },
    ],
  },
  {
    run: () => notifyJobApproved(7, "tech-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyJobApproved(7, "boss"),
    emails: 1,
    rows: [
      {
        to: ["tech-1"],
        type: "JOB_APPROVED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Calibração aprovada",
        message: "Nome aprovou a OS OS-100. O certificado está sendo gerado.",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/7",
      },
    ],
  },
  {
    run: () => notifyJobRejected(7, "tech-1", "motivo"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyJobRejected(7, "boss", "motivo"),
    emails: 1,
    rows: [
      {
        to: ["tech-1"],
        type: "JOB_REJECTED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Calibração rejeitada",
        message: "Nome rejeitou a OS OS-100. Motivo: motivo",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/7",
      },
    ],
  },
  {
    run: () => notifyJobAssigned(7, "tech-1", "tech-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyJobAssigned(7, "tech-1", "boss"),
    emails: 0,
    rows: [
      {
        to: ["tech-1"],
        type: "JOB_ASSIGNED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Nova calibração atribuída",
        message: "Nome atribuiu a OS OS-100 para você.",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/7",
      },
    ],
  },
  {
    run: () => notifyCertificateReady(7),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "CERTIFICATE_READY",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Certificado de calibração disponível",
        message:
          "O certificado da OS OS-100 está pronto para download no portal.",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/portal/certificates",
      },
    ],
  },
  {
    run: () => notifyAssetFoundOutOfTolerance(7),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "ASSET_FOUND_OUT_OF_TOLERANCE",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Ação requerida: avaliar impacto",
        message:
          'O equipamento TAG1 foi reprovado na condição "como recebido" na calibração OS-100. Avalie o impacto sobre medições anteriores no portal.',
        relatedEntity: { entityType: "asset", entityId: 9 },
        actionUrl: "/portal/assets/9",
      },
    ],
  },
  {
    run: () => notifyAuditPackReady(3),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "AUDIT_PACK_READY",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Pacote de auditoria disponível",
        message:
          "O pacote de auditoria do período 01/01/2026 a 31/03/2026 está pronto para download no portal.",
        relatedEntity: { entityType: "audit_pack", entityId: 3 },
        actionUrl: "/portal/certificates",
      },
    ],
  },
  {
    run: () => notifyCertificateAmended(7, 8, "razão"),
    emails: 4,
    rows: [
      {
        to: ["u1", "u2"],
        type: "CERTIFICATE_AMENDED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Certificado de calibração retificado",
        message:
          "O certificado OS-100 foi retificado. Novo certificado: OS-100. Motivo: razão",
        relatedEntity: { entityType: "job", entityId: 8, jobId: "OS-100" },
        actionUrl: "/portal/certificates/OS-100",
      },
      {
        to: ["u1", "u2"],
        type: "CERTIFICATE_AMENDED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Certificado retificado",
        message:
          "O certificado OS-100 foi retificado. Novo: OS-100. Motivo: razão",
        relatedEntity: { entityType: "job", entityId: 8, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/8",
      },
    ],
  },
  {
    run: () => notifyAssetDueForRecalibration(9, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "ASSET_DUE_FOR_RECALIBRATION",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Ativo vencendo calibração",
        message:
          "O instrumento TAG1 está com calibração vencendo em 20 dias (30/06/2026).",
        relatedEntity: { entityType: "asset", entityId: 9 },
        actionUrl: "/dashboard/assets/9",
      },
    ],
  },
  {
    run: () => notifyAssetDueForLegalVerification(9, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "ASSET_DUE_FOR_LEGAL_VERIFICATION",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Verificação metrológica legal próxima",
        message:
          "O instrumento TAG1 está sob regime de metrologia legal e tem verificação metrológica prevista para cerca de 30/06/2026 (aproximadamente 20 dias). A cadência é operacionalizada pelo Ipem — a data é indicativa, não é um prazo nacional fixo. Acompanhe o cronograma do órgão delegado. Regulamento: Portaria 1.",
        relatedEntity: { entityType: "asset", entityId: 9 },
        actionUrl: "/dashboard/assets/9",
      },
    ],
  },
  {
    run: () => notifyStandardExpiring(4, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "STANDARD_EXPIRING",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Padrão de referência vencendo",
        message:
          "O padrão CERT1 está com calibração vencendo em 20 dias (30/06/2026).",
        relatedEntity: { entityType: "standard", entityId: 4 },
        actionUrl: "/dashboard/standards/4",
      },
    ],
  },
  {
    run: () => notifyPtPlanDue(2, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "PT_PLAN_DUE",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Participação em ensaio de proficiência vencendo",
        message:
          'O escopo "Massa" precisa de participação em ensaio de proficiência até 30/06/2026 (20 dias).',
        relatedEntity: { entityType: "pt_plan_item", entityId: 2 },
        actionUrl: "/dashboard/proficiency-tests/plan",
      },
    ],
  },
  {
    run: () => notifyStandardExpired(4, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "STANDARD_EXPIRED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Padrão de referência vencido",
        message:
          "O padrão CERT1 venceu em 30/06/2026. Atualize ou substitua antes de novas calibrações.",
        relatedEntity: { entityType: "standard", entityId: 4 },
        actionUrl: "/dashboard/standards/4",
      },
    ],
  },
  {
    run: () =>
      notifySigningCertificateExpiring(1, "org-lab", { daysRemaining: 3 }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "SIGNING_CERTIFICATE_EXPIRING",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Certificado de assinatura expirando",
        message:
          "O certificado de assinatura Nome (SN1) da unidade Unidade A expira em 3 dias (30/06/2026). Renove o certificado A1 ICP-Brasil antes do vencimento: depois dele, nenhum certificado de calibração desta unidade é emitido até que um novo certificado de assinatura seja enviado.",
        actionUrl: "/dashboard/settings/signature",
      },
    ],
  },
  {
    run: () =>
      notifySigningCertificateExpiring(1, "org-lab", { daysRemaining: 20 }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "SIGNING_CERTIFICATE_EXPIRING",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Certificado de assinatura expirando",
        message:
          "O certificado de assinatura Nome (SN1) da unidade Unidade A expira em 20 dias (30/06/2026). Renove o certificado A1 ICP-Brasil antes do vencimento: depois dele, nenhum certificado de calibração desta unidade é emitido até que um novo certificado de assinatura seja enviado.",
        actionUrl: "/dashboard/settings/signature",
      },
    ],
  },
  {
    run: () =>
      notifyAuditChainBroken("org-lab", {
        table: "t",
        kind: "row_hash_mismatch",
        chainSeq: 5,
        rowId: 9,
      }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "AUDIT_CHAIN_BROKEN",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Trilha de auditoria com inconsistência",
        message:
          "A verificação da trilha de auditoria de calibrações (t) encontrou uma inconsistência: um registro foi alterado depois de gravado (posição 5, registro 9). Os registros foram preservados como estão. Contate o suporte e preserve o banco de dados e os backups para a investigação.",
      },
    ],
  },
  {
    run: () =>
      notifyAuditChainBroken("org-lab", {
        table: "t",
        kind: "weird",
        chainSeq: null,
        rowId: 3,
      }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "AUDIT_CHAIN_BROKEN",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Trilha de auditoria com inconsistência",
        message:
          "A verificação da trilha de auditoria de calibrações (t) encontrou uma inconsistência: a trilha não confere (registro 3). Os registros foram preservados como estão. Contate o suporte e preserve o banco de dados e os backups para a investigação.",
      },
    ],
  },
  {
    run: () =>
      notifyAuditChainBroken("org-lab", {
        table: "t",
        kind: "sequence_gap",
        chainSeq: 4,
        rowId: null,
      }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "AUDIT_CHAIN_BROKEN",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Trilha de auditoria com inconsistência",
        message:
          "A verificação da trilha de auditoria de calibrações (t) encontrou uma inconsistência: há um registro removido da sequência (posição 4). Os registros foram preservados como estão. Contate o suporte e preserve o banco de dados e os backups para a investigação.",
      },
    ],
  },
  {
    run: () =>
      notifyAuditChainBroken("org-lab", {
        table: "t",
        kind: "sequence_gap",
        chainSeq: null,
        rowId: null,
      }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "AUDIT_CHAIN_BROKEN",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Trilha de auditoria com inconsistência",
        message:
          "A verificação da trilha de auditoria de calibrações (t) encontrou uma inconsistência: há um registro removido da sequência. Os registros foram preservados como estão. Contate o suporte e preserve o banco de dados e os backups para a investigação.",
      },
    ],
  },
  {
    run: () => notifySigningCertificateLapsed(7, "expirou"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "SIGNING_CERTIFICATE_LAPSED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Certificado não emitido: assinatura digital indisponível",
        message: "O certificado OS-100 não foi emitido: expirou",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/settings/signature",
      },
    ],
  },
  {
    run: () =>
      notifyAccreditationExpiring("org-lab", {
        daysRemaining: 1,
        validUntil: day(1),
      }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "ACCREDITATION_EXPIRING",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Acreditação com vigência expirando",
        message:
          "A vigência da acreditação Cgcre/RBC do laboratório termina em 1 dia (11/06/2026). Após o vencimento, certificados de métodos com escopo acreditado passam a ser emitidos SEM o selo da acreditação. Atualize a janela de vigência nas configurações após a renovação.",
        actionUrl: "/dashboard/settings/organization",
      },
    ],
  },
  {
    run: () =>
      notifyAccreditationExpiring("org-lab", {
        daysRemaining: 30,
        validUntil: day(30),
      }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "ACCREDITATION_EXPIRING",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Acreditação com vigência expirando",
        message:
          "A vigência da acreditação Cgcre/RBC do laboratório termina em 30 dias (10/07/2026). Após o vencimento, certificados de métodos com escopo acreditado passam a ser emitidos SEM o selo da acreditação. Atualize a janela de vigência nas configurações após a renovação.",
        actionUrl: "/dashboard/settings/organization",
      },
    ],
  },
  {
    run: () =>
      notifyAccreditedScopeLineExpiring(5, "org-lab", { daysRemaining: 3 }),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "ACCREDITED_SCOPE_LINE_EXPIRING",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Linha do escopo acreditado expirando",
        message:
          "A vigência da linha Massa 0 a 100 g (desc) na unidade Unidade A termina em 3 dias (30/06/2026). Após o vencimento, pontos nessa faixa deixam de casar com o escopo e a emissão acreditada passa a classificar como fora de escopo. Atualize a linha nas configurações após a renovação do escopo.",
        actionUrl: "/dashboard/settings/accredited-scope",
      },
    ],
  },
  {
    run: () => notifyJobOverdue(7),
    emails: 4,
    rows: [
      {
        to: ["tech-1", "creator-1", "u1", "u2"],
        type: "JOB_OVERDUE",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Calibração atrasada",
        message:
          "A OS OS-100 está atrasada há 20 dias (vencimento: 30/06/2026).",
        relatedEntity: { entityType: "job", entityId: 7, jobId: "OS-100" },
        actionUrl: "/dashboard/jobs/7",
      },
    ],
  },
  {
    run: () => notifyNCCreated(1, "NC-1", "equipment", "desc", "org-lab", "u1"),
    emails: 1,
    rows: [
      {
        to: ["u2"],
        type: "NC_CREATED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Nova não conformidade registrada",
        message: "Nome registrou a NC-1 (equipamento).",
        relatedEntity: { entityType: "nc", entityId: 1 },
        actionUrl: "/dashboard/nc/1",
      },
    ],
  },
  {
    run: () => notifyNCCreated(1, "NC-1", "work", "desc", "org-lab", "x"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "NC_CREATED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Nova não conformidade registrada",
        message: "Nome registrou a NC-1 (trabalho).",
        relatedEntity: { entityType: "nc", entityId: 1 },
        actionUrl: "/dashboard/nc/1",
      },
    ],
  },
  {
    run: () =>
      notifyNCCreated(1, "NC-1", "out_of_tolerance", "desc", "org-lab", "x"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "NC_CREATED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Nova não conformidade registrada",
        message: "Nome registrou a NC-1 (fora de tolerância).",
        relatedEntity: { entityType: "nc", entityId: 1 },
        actionUrl: "/dashboard/nc/1",
      },
    ],
  },
  {
    run: () =>
      notifyNCCreated(1, "NC-1", "documentation", "desc", "org-lab", "x"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "NC_CREATED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Nova não conformidade registrada",
        message: "Nome registrou a NC-1 (documentação).",
        relatedEntity: { entityType: "nc", entityId: 1 },
        actionUrl: "/dashboard/nc/1",
      },
    ],
  },
  {
    run: () => notifyOotAcknowledged(11, 1, "NC-1", "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "OOT_NOTIFICATION_ACKNOWLEDGED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Notificação 7.10 confirmada pelo cliente",
        message:
          "O cliente confirmou o recebimento da notificação de fora de tolerância da NC-1 (notificação #11).",
        relatedEntity: { entityType: "nc", entityId: 1 },
        actionUrl: "/dashboard/nc/1",
      },
    ],
  },
  {
    run: () =>
      notifyNCEscalatedToCapa(1, "NC-1", 2, "CAPA-2", "desc", "org-lab", "u1"),
    emails: 1,
    rows: [
      {
        to: ["u2"],
        type: "NC_ESCALATED_TO_CAPA",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "NC escalada para CAPA",
        message: "Nome escalou a NC-1 para CAPA-2.",
        relatedEntity: { entityType: "capa", entityId: 2 },
        actionUrl: "/dashboard/capa/2",
      },
    ],
  },
  {
    run: () =>
      notifyNCEscalatedToCapa(1, "NC-1", 2, "CAPA-2", "desc", "org-lab", "x"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "NC_ESCALATED_TO_CAPA",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "NC escalada para CAPA",
        message: "Nome escalou a NC-1 para CAPA-2.",
        relatedEntity: { entityType: "capa", entityId: 2 },
        actionUrl: "/dashboard/capa/2",
      },
    ],
  },
  {
    run: () => notifyCompetenceExpiring(3, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "COMPETENCE_EXPIRING",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Competência vencendo",
        message:
          "A competência de Nome (Escopo X) vence em 20 dias (30/06/2026).",
        relatedEntity: { entityType: "competence", entityId: 3 },
        actionUrl: "/dashboard/personnel/3",
      },
    ],
  },
  {
    run: () => notifyCompetenceExpired(3, "org-lab"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "COMPETENCE_EXPIRED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Competência EXPIRADA",
        message:
          "A competência de Nome (Escopo X) expirou. Atribuições com este escopo estão bloqueadas.",
        relatedEntity: { entityType: "competence", entityId: 3 },
        actionUrl: "/dashboard/personnel/3",
      },
    ],
  },
  {
    run: () => notifyCompetenceRequested(3, "org-lab", "u1"),
    emails: 1,
    rows: [
      {
        to: ["u2"],
        type: "COMPETENCE_REQUESTED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Nova solicitação de competência",
        message: "Nome solicitou qualificação para Nome: Escopo X.",
        relatedEntity: { entityType: "competence", entityId: 3 },
        actionUrl: "/dashboard/personnel/3",
      },
    ],
  },
  {
    run: () => notifyCompetenceRequested(3, "org-lab", "x"),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "COMPETENCE_REQUESTED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Nova solicitação de competência",
        message: "Nome solicitou qualificação para Nome: Escopo X.",
        relatedEntity: { entityType: "competence", entityId: 3 },
        actionUrl: "/dashboard/personnel/3",
      },
    ],
  },
  {
    run: () => notifyCompetenceApproved(3, "org-lab", "tech-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyCompetenceApproved(3, "org-lab", "boss"),
    emails: 1,
    rows: [
      {
        to: ["tech-1"],
        type: "COMPETENCE_APPROVED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Competência aprovada",
        message: "Nome aprovou sua qualificação: Escopo X.",
        relatedEntity: { entityType: "competence", entityId: 3 },
        actionUrl: "/dashboard/personnel/3",
      },
    ],
  },
  {
    run: () => notifyCalibrationRequestSubmitted(5),
    emails: 2,
    rows: [
      {
        to: ["u1", "u2"],
        type: "CALIBRATION_REQUEST_SUBMITTED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Nova solicitação de calibração",
        message: "ACME enviou a solicitação #5 com 2 itens.",
        relatedEntity: { entityType: "request", entityId: 5 },
        actionUrl: "/dashboard/requests/5",
      },
    ],
  },
  {
    run: () => notifyCalibrationRequestUnderReview(5, "cust-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyCalibrationRequestUnderReview(5, "boss"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "CALIBRATION_REQUEST_UNDER_REVIEW",
        organizationId: "org-client",
        priority: "MEDIUM",
        title: "Solicitação em análise",
        message: "Lab Acme começou a analisar a solicitação #5.",
        relatedEntity: { entityType: "request", entityId: 5 },
        actionUrl: "/portal/requests/5",
      },
    ],
  },
  {
    run: () => notifyCalibrationRequestApproved(5, "cust-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyCalibrationRequestApproved(5, "boss"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "CALIBRATION_REQUEST_APPROVED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Solicitação de calibração aprovada",
        message: "Lab Acme aprovou a solicitação #5.",
        relatedEntity: { entityType: "request", entityId: 5 },
        actionUrl: "/portal/requests/5",
      },
    ],
  },
  {
    run: () => notifyCalibrationRequestRejected(5, "boss", "motivo"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "CALIBRATION_REQUEST_REJECTED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Solicitação de calibração recusada",
        message: "Lab Acme recusou a solicitação #5. Motivo: motivo",
        relatedEntity: { entityType: "request", entityId: 5 },
        actionUrl: "/portal/requests/5",
      },
    ],
  },
  {
    run: () => notifyCalibrationRequestConverted(5, "boss", ["J1", "J2"]),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "CALIBRATION_REQUEST_CONVERTED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Solicitação convertida em ordem de serviço",
        message: "Lab Acme converteu a solicitação #5 em 2 ordens de serviço.",
        relatedEntity: { entityType: "request", entityId: 5 },
        actionUrl: "/portal/requests/5",
      },
    ],
  },
  {
    run: () => notifyCalibrationRequestConverted(5, "boss", ["J1"]),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "CALIBRATION_REQUEST_CONVERTED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Solicitação convertida em ordem de serviço",
        message: "Lab Acme converteu a solicitação #5 em 1 ordem de serviço.",
        relatedEntity: { entityType: "request", entityId: 5 },
        actionUrl: "/portal/requests/5",
      },
    ],
  },
  {
    run: () => notifyVisitScheduled(1, "tech-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyVisitScheduled(1, "boss"),
    emails: 0,
    rows: [
      {
        to: ["tech-1"],
        type: "VISIT_SCHEDULED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Nova visita no local",
        message:
          "Nome agendou uma visita ao cliente ACME (30/06/2026) para você.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits",
      },
    ],
  },
  {
    run: () => notifyVisitConfirmed(1, "cust-1"),
    emails: 0,
    rows: [],
  },
  {
    run: () => notifyVisitConfirmed(1, "boss"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "VISIT_CONFIRMED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Visita no local confirmada",
        message:
          "Lab Acme confirmou a visita de calibração no local para 30/06/2026 com o técnico João.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/requests/42",
      },
    ],
  },
  {
    run: () => notifyVisitRescheduled(1, "boss"),
    emails: 2,
    rows: [
      {
        to: ["tech-1"],
        type: "VISIT_RESCHEDULED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Visita no local reagendada",
        message: "A visita ao cliente ACME foi reagendada para 30/06/2026.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits",
      },
      {
        to: ["cust-1"],
        type: "VISIT_RESCHEDULED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Visita no local reagendada",
        message:
          "Lab Acme reagendou sua visita de calibração no local para 30/06/2026.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/requests/42",
      },
    ],
  },
  {
    run: () => notifyVisitRescheduled(1, "tech-1"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "VISIT_RESCHEDULED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Visita no local reagendada",
        message:
          "Lab Acme reagendou sua visita de calibração no local para 30/06/2026.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/requests/42",
      },
    ],
  },
  {
    run: () => notifyVisitCancelled(1, "boss", "  razão "),
    emails: 2,
    rows: [
      {
        to: ["tech-1"],
        type: "VISIT_CANCELLED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Visita no local cancelada",
        message: "A visita ao cliente ACME foi cancelada. Motivo: razão.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits",
      },
      {
        to: ["cust-1"],
        type: "VISIT_CANCELLED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Visita no local cancelada",
        message:
          "Lab Acme cancelou sua visita de calibração no local. Motivo: razão.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/requests/42",
      },
    ],
  },
  {
    run: () => notifyVisitCancelled(1, "boss"),
    emails: 2,
    rows: [
      {
        to: ["tech-1"],
        type: "VISIT_CANCELLED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Visita no local cancelada",
        message: "A visita ao cliente ACME foi cancelada.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits",
      },
      {
        to: ["cust-1"],
        type: "VISIT_CANCELLED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Visita no local cancelada",
        message: "Lab Acme cancelou sua visita de calibração no local.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/requests/42",
      },
    ],
  },
  {
    run: () => notifyVisitReminder(1),
    emails: 2,
    rows: [
      {
        to: ["tech-1"],
        type: "VISIT_REMINDER",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Lembrete de visita no local",
        message: "Lembrete: visita ao cliente ACME em 30/06/2026.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits",
      },
      {
        to: ["cust-1"],
        type: "VISIT_REMINDER",
        organizationId: "org-client",
        priority: "MEDIUM",
        title: "Lembrete de visita no local",
        message:
          "Lembrete: Lab Acme fará a visita de calibração no local em 30/06/2026.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/requests/42",
      },
    ],
  },
  {
    run: () => notifyVisitCustomerConfirmed(1, "u1"),
    emails: 0,
    rows: [
      {
        to: ["u2"],
        type: "VISIT_CUSTOMER_CONFIRMED",
        organizationId: "org-lab",
        priority: "MEDIUM",
        title: "Cliente confirmou presença na visita",
        message:
          "ACME confirmou que estará pronto para receber o técnico em 30/06/2026.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits/1",
      },
    ],
  },
  {
    run: () => notifyVisitRescheduleRequested(1, "u1"),
    emails: 1,
    rows: [
      {
        to: ["u2"],
        type: "VISIT_RESCHEDULE_REQUESTED",
        organizationId: "org-lab",
        priority: "HIGH",
        title: "Cliente solicitou reagendamento de visita",
        message:
          "ACME solicitou o reagendamento da visita de 30/06/2026. Aceite ou recuse a solicitação.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/dashboard/visits/1",
      },
    ],
  },
  {
    run: () => notifyVisitRescheduleDeclined(1, "boss", "motivo"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "VISIT_RESCHEDULE_DECLINED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Reagendamento não foi possível",
        message: "Lab Acme não pôde reagendar a visita de 30/06/2026: motivo",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/calendar",
      },
    ],
  },
  {
    run: () => notifyVisitRescheduleDeclined(1, "boss"),
    emails: 1,
    rows: [
      {
        to: ["cust-1"],
        type: "VISIT_RESCHEDULE_DECLINED",
        organizationId: "org-client",
        priority: "HIGH",
        title: "Reagendamento não foi possível",
        message:
          "Lab Acme não pôde reagendar a visita de 30/06/2026. A data original está mantida.",
        relatedEntity: { entityType: "visit", entityId: 1 },
        actionUrl: "/portal/calendar",
      },
    ],
  },
  {
    run: () => notifyVisitRescheduleDeclined(1, "cust-1"),
    emails: 0,
    rows: [],
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  recorded.inserts.length = 0;
  recorded.emails.length = 0;
  recorded.nextId = 100;
});

describe("the recipe table", () => {
  it("has exactly one recipe per registry type", () => {
    expect(new Set(Object.keys(NOTIFICATION_RECIPES))).toEqual(
      new Set(NOTIFICATION_TYPES),
    );
  });
});

describe("notify", () => {
  it.each(CASES.map((testCase, index) => ({ ...testCase, index })))(
    "case  delivers the pinned rows and e-mails",
    async ({ run, rows, emails }) => {
      await run();

      const delivered = recorded.inserts.map((insert) => ({
        to: insert["recipientUserId"],
        type: insert["type"],
        organizationId: insert["organizationId"],
        priority: insert["priority"],
        title: insert["title"],
        message: insert["message"],
        relatedEntity: insert["relatedEntity"],
        actionUrl: insert["actionUrl"],
      }));
      // One pinned row stands for every recipient it names, in order.
      const expected = rows.flatMap(({ to, ...rest }) =>
        to.map((recipient) => ({
          to: recipient,
          relatedEntity: undefined,
          actionUrl: undefined,
          ...rest,
        })),
      );
      expect(delivered).toEqual(expected);
      expect(recorded.emails).toHaveLength(emails);
    },
  );

  it("is what a notifyXxx wrapper calls", async () => {
    await notifyJobApproved(7, "boss");
    const viaWrapper = [...recorded.inserts];
    recorded.inserts.length = 0;

    await notify("JOB_APPROVED", { jobId: 7, approvedByUserId: "boss" });

    expect(recorded.inserts).toEqual(viaWrapper);
    expect(viaWrapper).toHaveLength(1);
  });

  it("delivers rows one at a time: the second recipient is read after the first was sent", async () => {
    const order: string[] = [];
    const originalSelect = fakeDb.select;
    fakeDb.select = (fields) => {
      order.push(fields ? Object.keys(fields).join(",") : "preferences");
      return originalSelect(fields);
    };
    try {
      await notifyVisitRescheduled(1, "boss");
    } finally {
      fakeDb.select = originalSelect;
    }
    // The technician's send (preferences, user) finishes before the
    // customer's brand is read.
    const brandRead = order.findIndex((query) =>
      query.startsWith("name,logo,"),
    );
    expect(order.slice(brandRead - 2, brandRead)).toEqual([
      "preferences",
      "email,name",
    ]);
  });
});
