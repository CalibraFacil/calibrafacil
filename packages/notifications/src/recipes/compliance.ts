// Recipes of the compliance alerts: recalibration and legal verification, standards, proficiency tests, signing certificate, audit chain, accreditation.
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.
import {
  accreditedScopeLine,
  customer,
  asset,
  referenceStandard,
  organizationSigningCertificate,
  organizationUnit,
  ptPlanItem,
} from "@calibra-facil/db/schema";
import { eq, and } from "drizzle-orm";
import { quantityKindLabelPt } from "@calibra-facil/shared";
import {
  formatCalendarDate,
  formatInstant,
} from "@calibra-facil/shared/format";
import { inOrg } from "../lab-scope";
import { buildLegalVerificationMessage } from "../legal-verification-message";
import { getDaysRemaining, adminsAndOwners } from "./lookups";
import type { NotificationRecipes } from "./types";

/** What the audit-chain verifier found, in words a laboratory admin can act on. */
const AUDIT_CHAIN_BREAK_LABEL: Record<string, string> = {
  row_hash_mismatch: "um registro foi alterado depois de gravado",
  prev_hash_mismatch: "o encadeamento entre dois registros não confere",
  sequence_gap: "há um registro removido da sequência",
  unchained_row: "há um registro que nunca foi encadeado",
  checkpoint_missing:
    "registros verificados anteriormente foram removidos do fim da trilha",
  checkpoint_mismatch:
    "um registro verificado anteriormente foi alterado ou substituído",
};

export const complianceRecipes = {
  /**
   * Notify lab members when a customer's asset is due for recalibration
   * Called by a scheduled job that checks asset.nextCalibrationDate
   */
  async *ASSET_DUE_FOR_RECALIBRATION({ assetId, organizationId }) {
    const [assetData] = await inOrg(organizationId, (o) =>
      o
        .select({
          name: asset.name,
          serialNumber: asset.serialNumber,
          tag: asset.tag,
          nextCalibrationDate: asset.nextCalibrationDate,
          customerId: asset.customerId,
        })
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1),
    );

    if (!assetData?.nextCalibrationDate) return;

    const [customerData] = await inOrg(organizationId, (o) =>
      o
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.id, assetData.customerId))
        .limit(1),
    );

    const daysRemaining = getDaysRemaining(assetData.nextCalibrationDate);
    const dueDate = formatCalendarDate(assetData.nextCalibrationDate);
    const assetIdentifier =
      assetData.tag || assetData.serialNumber || assetData.name;
    const itemName = customerData
      ? `${assetData.name} (${customerData.name})`
      : assetData.name;

    // Notify admins and owners of the lab
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "ASSET_DUE_FOR_RECALIBRATION",
        priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
        title: "Ativo vencendo calibração",
        message: `O instrumento ${assetIdentifier} está com calibração vencendo em ${daysRemaining} dias (${dueDate}).`,
        relatedEntity: {
          entityType: "asset",
          entityId: assetId,
        },
        actionUrl: `/dashboard/assets/${assetId}`,
        emailContext: {
          type: "compliance",
          data: {
            itemName,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Notify lab members when a customer's legal-metrology instrument is due for its
   * regulation-fixed VERIFICATION (Track 2 — Inmetro / RBMLQ-I), INDEPENDENTLY of
   * the recalibration reminder (`notifyAssetDueForRecalibration`). Called by the
   * scheduled sweep that checks asset.nextLegalVerificationDate for LEGAL-regime
   * instruments. No-ops for any asset whose `metrologyRegime` is not 'LEGAL' or
   * whose `nextLegalVerificationDate` is null.
   */
  async *ASSET_DUE_FOR_LEGAL_VERIFICATION({ assetId, organizationId }) {
    // Get asset details with regime + regulated-interval info
    const [assetData] = await inOrg(organizationId, (o) =>
      o
        .select({
          name: asset.name,
          serialNumber: asset.serialNumber,
          tag: asset.tag,
          metrologyRegime: asset.metrologyRegime,
          nextLegalVerificationDate: asset.nextLegalVerificationDate,
          regulatedInterval: asset.regulatedInterval,
          customerId: asset.customerId,
        })
        .from(asset)
        .where(eq(asset.id, assetId))
        .limit(1),
    );

    // Track 2 only: never fire for a non-LEGAL regime or a missing legal-verification date.
    if (assetData?.metrologyRegime !== "LEGAL") return;
    if (!assetData.nextLegalVerificationDate) return;

    // Read the structured regulated interval defensively (stored loosely as
    // Record<string, unknown>; no `as` assertions — narrow by typeof).
    const regulated = assetData.regulatedInterval;
    const operationalizedByDelegate =
      regulated?.operationalizedByDelegate === true;
    const regulationRefValue = regulated?.regulationReference;
    const regulationReference =
      typeof regulationRefValue === "string" ? regulationRefValue : null;

    const [customerData] = await inOrg(organizationId, (o) =>
      o
        .select({ name: customer.name })
        .from(customer)
        .where(eq(customer.id, assetData.customerId))
        .limit(1),
    );

    const daysRemaining = getDaysRemaining(assetData.nextLegalVerificationDate);
    const dueDate = formatCalendarDate(assetData.nextLegalVerificationDate);
    const assetIdentifier =
      assetData.tag || assetData.serialNumber || assetData.name;
    const itemName = customerData
      ? `${assetData.name} (${customerData.name})`
      : assetData.name;

    const message = buildLegalVerificationMessage({
      assetIdentifier,
      dueDate,
      daysRemaining,
      operationalizedByDelegate,
      regulationReference,
    });

    // Notify admins and owners of the lab
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "ASSET_DUE_FOR_LEGAL_VERIFICATION",
        priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
        title: "Verificação metrológica legal próxima",
        message,
        relatedEntity: {
          entityType: "asset",
          entityId: assetId,
        },
        actionUrl: `/dashboard/assets/${assetId}`,
        emailContext: {
          type: "compliance",
          data: {
            itemName,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Notify lab members when a reference standard is expiring
   * Called by a scheduled job that checks referenceStandard.nextCalibrationDate
   */
  async *STANDARD_EXPIRING({ standardId, organizationId }) {
    const [standardData] = await inOrg(organizationId, (o) =>
      o
        .select({
          name: referenceStandard.name,
          serialNumber: referenceStandard.serialNumber,
          certificateNumber: referenceStandard.certificateNumber,
          nextCalibrationDate: referenceStandard.nextCalibrationDate,
        })
        .from(referenceStandard)
        .where(eq(referenceStandard.id, standardId))
        .limit(1),
    );

    if (!standardData?.nextCalibrationDate) return;

    const daysRemaining = getDaysRemaining(standardData.nextCalibrationDate);
    const dueDate = formatCalendarDate(standardData.nextCalibrationDate);
    const standardIdentifier =
      standardData.certificateNumber ||
      standardData.serialNumber ||
      standardData.name;
    const itemName = `${standardData.name} (${standardIdentifier})`;

    // Notify admins and owners of the lab
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "STANDARD_EXPIRING",
        priority: daysRemaining <= 3 ? "HIGH" : "MEDIUM",
        title: "Padrão de referência vencendo",
        message: `O padrão ${standardIdentifier} está com calibração vencendo em ${daysRemaining} dias (${dueDate}).`,
        relatedEntity: {
          entityType: "standard",
          entityId: standardId,
        },
        actionUrl: `/dashboard/standards/${standardId}`,
        emailContext: {
          type: "compliance",
          data: {
            itemName,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Notify lab admins/owners when a proficiency-test participation-plan item is
   * due (or overdue) for its scope part — ISO/IEC 17025 §7.7.2 / issue #60.
   * Called by the scheduled sweep off ptPlanItem.nextDueAt.
   */
  async *PT_PLAN_DUE({ planItemId, organizationId }) {
    const [planItem] = await inOrg(organizationId, (o) =>
      o
        .select({
          scopePart: ptPlanItem.scopePart,
          nextDueAt: ptPlanItem.nextDueAt,
        })
        .from(ptPlanItem)
        .where(eq(ptPlanItem.id, planItemId))
        .limit(1),
    );

    if (!planItem?.nextDueAt) return;

    const daysRemaining = getDaysRemaining(planItem.nextDueAt);
    const dueDate = formatCalendarDate(planItem.nextDueAt);
    const overdue = daysRemaining < 0;

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "PT_PLAN_DUE",
        priority: overdue ? "HIGH" : "MEDIUM",
        title: overdue
          ? "Participação em ensaio de proficiência vencida"
          : "Participação em ensaio de proficiência vencendo",
        message: overdue
          ? `O escopo "${planItem.scopePart}" está com a participação em ensaio de proficiência vencida desde ${dueDate} (ISO 17025 §7.7.2).`
          : `O escopo "${planItem.scopePart}" precisa de participação em ensaio de proficiência até ${dueDate} (${daysRemaining} dias).`,
        relatedEntity: {
          entityType: "pt_plan_item",
          entityId: planItemId,
        },
        actionUrl: `/dashboard/proficiency-tests/plan`,
        emailContext: {
          type: "compliance",
          data: {
            itemName: `Ensaio de proficiência — ${planItem.scopePart}`,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Notify lab members when a reference standard is expired.
   * Called by scheduled jobs or manual checks that inspect referenceStandard.nextCalibrationDate.
   */
  async *STANDARD_EXPIRED({ standardId, organizationId }) {
    const [standardData] = await inOrg(organizationId, (o) =>
      o
        .select({
          name: referenceStandard.name,
          serialNumber: referenceStandard.serialNumber,
          certificateNumber: referenceStandard.certificateNumber,
          nextCalibrationDate: referenceStandard.nextCalibrationDate,
        })
        .from(referenceStandard)
        .where(eq(referenceStandard.id, standardId))
        .limit(1),
    );

    if (!standardData?.nextCalibrationDate) return;

    const daysRemaining = getDaysRemaining(standardData.nextCalibrationDate);
    const dueDate = formatCalendarDate(standardData.nextCalibrationDate);
    const standardIdentifier =
      standardData.certificateNumber ||
      standardData.serialNumber ||
      standardData.name;
    const itemName = `${standardData.name} (${standardIdentifier})`;

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "STANDARD_EXPIRED",
        priority: "HIGH",
        title: "Padrão de referência vencido",
        message: `O padrão ${standardIdentifier} venceu em ${dueDate}. Atualize ou substitua antes de novas calibrações.`,
        relatedEntity: {
          entityType: "standard",
          entityId: standardId,
        },
        actionUrl: `/dashboard/standards/${standardId}`,
        emailContext: {
          type: "compliance",
          data: {
            itemName,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Notify a lab's admins/owners that an ICP-Brasil A1 signing certificate is
   * nearing its `validUntil` (issue #645 · CMP-02). Called by the daily
   * compliance cron when a certificate enters an escalating lead window
   * (30/15/7 days). Reads validity only — never touches signing crypto.
   *
   * `daysRemaining`/`leadTimeDays` come from the pure decider so the copy stays
   * consistent with the window that triggered the alert.
   */
  async *SIGNING_CERTIFICATE_EXPIRING({
    certificateId,
    organizationId,
    context,
  }) {
    // Org-scoped read (defense in depth): a certificate id is globally unique,
    // but filtering by organizationId guarantees we never resolve/notify across
    // tenants. Join the unit so the alert names which unit's certificate expires.
    const [certData] = await inOrg(organizationId, (o) =>
      o
        .select({
          name: organizationSigningCertificate.name,
          serialNumber: organizationSigningCertificate.serialNumber,
          validUntil: organizationSigningCertificate.validUntil,
          unitName: organizationUnit.name,
        })
        .from(organizationSigningCertificate)
        .innerJoin(
          organizationUnit,
          eq(organizationSigningCertificate.unitId, organizationUnit.id),
        )
        .where(
          and(
            eq(organizationSigningCertificate.id, certificateId),
            eq(organizationSigningCertificate.organizationId, organizationId),
          ),
        )
        .limit(1),
    );

    if (!certData) return;

    const dueDate = formatInstant(certData.validUntil, "date");
    const daysRemaining = context.daysRemaining;
    const itemName = `${certData.name} (${certData.serialNumber}) — unidade ${certData.unitName}`;

    // Notify admins and owners of the lab
    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "SIGNING_CERTIFICATE_EXPIRING",
        priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
        title: "Certificado de assinatura expirando",
        message: `O certificado de assinatura ${certData.name} (${certData.serialNumber}) da unidade ${certData.unitName} expira em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dueDate}). Renove o certificado A1 ICP-Brasil antes do vencimento: depois dele, nenhum certificado de calibração desta unidade é emitido até que um novo certificado de assinatura seja enviado.`,
        actionUrl: "/dashboard/settings/signature",
        emailContext: {
          type: "compliance",
          data: {
            itemName,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Alert a lab's admins/owners that the verification of the audit-trail hash chain
   * found a break: a record of the calibration audit trail was
   * edited, removed or inserted outside the application (ISO/IEC 17025 8.4 control of
   * records). Nothing is repaired automatically; the evidence is preserved as found.
   */
  async *AUDIT_CHAIN_BROKEN({ organizationId, context }) {
    const recipients = await adminsAndOwners(organizationId);
    const what =
      AUDIT_CHAIN_BREAK_LABEL[context.kind] ?? "a trilha não confere";
    const where =
      context.chainSeq !== null
        ? ` (posição ${context.chainSeq}${context.rowId !== null ? `, registro ${context.rowId}` : ""})`
        : context.rowId !== null
          ? ` (registro ${context.rowId})`
          : "";

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "AUDIT_CHAIN_BROKEN",
        priority: "HIGH",
        title: "Trilha de auditoria com inconsistência",
        message: `A verificação da trilha de auditoria de calibrações (${context.table}) encontrou uma inconsistência: ${what}${where}. Os registros foram preservados como estão. Contate o suporte e preserve o banco de dados e os backups para a investigação.`,
      };
    }
  },

  /**
   * Warn lab admins/owners that the Cgcre/RBC accreditation vigência is nearing
   * its end (#647). Once expired, certificates of accredited-scope methods are
   * emitted WITHOUT the accreditation seal (decided 2026-07-05) — so the lab
   * must renew (or update the window) ahead of time.
   */
  async *ACCREDITATION_EXPIRING({ organizationId, context }) {
    const dueDate = formatCalendarDate(context.validUntil);
    const daysRemaining = context.daysRemaining;

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "ACCREDITATION_EXPIRING",
        priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
        title: "Acreditação com vigência expirando",
        message: `A vigência da acreditação Cgcre/RBC do laboratório termina em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dueDate}). Após o vencimento, certificados de métodos com escopo acreditado passam a ser emitidos SEM o selo da acreditação. Atualize a janela de vigência nas configurações após a renovação.`,
        actionUrl: "/dashboard/settings/organization",
        emailContext: {
          type: "compliance",
          data: {
            itemName: "Acreditação Cgcre/RBC",
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },

  /**
   * Warn lab admins/owners that one accredited-scope (CMC) line's vigência is
   * nearing its end (#427 Phase 2). Once the line expires, points it covered
   * stop matching and accredited issuance in that range classifies as
   * OUT_OF_SCOPE — blocking approval when the org enforces the guard.
   */
  async *ACCREDITED_SCOPE_LINE_EXPIRING({
    scopeLineId,
    organizationId,
    context,
  }) {
    // Org-scoped read (defense in depth): never resolve/notify across tenants.
    // Join the unit so the alert names which site's scope line expires.
    const [lineData] = await inOrg(organizationId, (o) =>
      o
        .select({
          quantityKind: accreditedScopeLine.quantityKind,
          rangeMin: accreditedScopeLine.rangeMin,
          rangeMax: accreditedScopeLine.rangeMax,
          rangeUnit: accreditedScopeLine.rangeUnit,
          description: accreditedScopeLine.description,
          validUntil: accreditedScopeLine.validUntil,
          unitName: organizationUnit.name,
        })
        .from(accreditedScopeLine)
        .innerJoin(
          organizationUnit,
          eq(accreditedScopeLine.unitId, organizationUnit.id),
        )
        .where(
          and(
            eq(accreditedScopeLine.id, scopeLineId),
            eq(accreditedScopeLine.organizationId, organizationId),
          ),
        )
        .limit(1),
    );

    if (!lineData?.validUntil) return;

    const dueDate = formatCalendarDate(lineData.validUntil);
    const daysRemaining = context.daysRemaining;
    const kindLabel = quantityKindLabelPt(lineData.quantityKind);
    const lineName = `${kindLabel} ${lineData.rangeMin} a ${lineData.rangeMax} ${lineData.rangeUnit}${lineData.description ? ` (${lineData.description})` : ""} na unidade ${lineData.unitName}`;

    const recipients = await adminsAndOwners(organizationId);

    for (const recipientId of recipients) {
      yield {
        recipientUserId: recipientId,
        organizationId,
        type: "ACCREDITED_SCOPE_LINE_EXPIRING",
        priority: daysRemaining <= 7 ? "HIGH" : "MEDIUM",
        title: "Linha do escopo acreditado expirando",
        message: `A vigência da linha ${lineName} termina em ${daysRemaining} ${daysRemaining === 1 ? "dia" : "dias"} (${dueDate}). Após o vencimento, pontos nessa faixa deixam de casar com o escopo e a emissão acreditada passa a classificar como fora de escopo. Atualize a linha nas configurações após a renovação do escopo.`,
        actionUrl: "/dashboard/settings/accredited-scope",
        emailContext: {
          type: "compliance",
          data: {
            itemName: lineName,
            dueDate,
            daysRemaining,
          },
        },
      };
    }
  },
} satisfies Partial<NotificationRecipes>;
