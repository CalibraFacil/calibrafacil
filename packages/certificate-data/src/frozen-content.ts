/**
 * The content decisions of a certificate that are taken ONCE, at approval, and
 * frozen with the certificate input (roadmap 2, C1/C2):
 *
 *   - the signatory, from the approver's authorized-signatory record
 *     (ISO/IEC 17025 §6.2.6, §7.8.2.1(o)), not from the lab profile's free text
 *     and not from whoever is signed in;
 *   - the calibrating body: the legal name, CNPJ and address of the laboratory
 *     or unit that performed the calibration (§7.8.2.1(a));
 *   - whether metrological traceability was VERIFIED (§6.5.1, ILAC P10): every
 *     standard used had a calibration certificate, valid on the calibration
 *     day, from a provider recorded as accredited by an ILAC-MRA signatory
 *     (in Brazil: Cgcre, RBC). The certificate asserts SI traceability only
 *     when this is true.
 *
 * All pure: no clock, no database. The API (`loadCertificateJobSource`) reads
 * the rows; these functions decide.
 */

import {
  calendarDateFromKey,
  calendarDateKey,
  labCalendarDayKey,
} from "@calibra-facil/shared/calendar-date";

// ── signatory ───────────────────────────────────────────────────────────────

/**
 * The approver's authorized-signatory record as it was when the job was
 * approved. `title` is the role printed under the signature; it is the record's
 * own, never the lab profile's technical-manager title.
 */
export type FrozenSignatory = {
  recordId: number;
  name: string;
  title: string | null;
  /** Null = authorized for every scope (org-wide). */
  assetTypeId: number | null;
  scopeDescription: string | null;
  authorizedAt: string;
};

export type SignatoryRecordCandidate = {
  id: number;
  assetTypeId: number | null;
  title: string | null;
  scopeDescription: string | null;
  authorizedAt: Date | string;
  expiresAt: Date | string | null;
};

/**
 * The record that authorizes `approver` to sign a job on `assetTypeId` at `at`:
 * an ACTIVE, unexpired record for exactly that asset type, else the org-wide
 * one. Null when none covers the scope (the caller prints the name alone).
 * Records are expected pre-filtered to the approver, ACTIVE and not deleted.
 */
export function pickSignatoryRecord(
  records: readonly SignatoryRecordCandidate[],
  assetTypeId: number | null,
  at: Date,
): SignatoryRecordCandidate | null {
  const live = records.filter((record) => {
    if (record.expiresAt === null) return true;
    const expires = new Date(record.expiresAt);
    return !Number.isNaN(expires.getTime()) && expires >= at;
  });
  const exact =
    assetTypeId === null
      ? undefined
      : live.find((record) => record.assetTypeId === assetTypeId);
  if (exact) return exact;
  return live.find((record) => record.assetTypeId === null) ?? null;
}

export function freezeSignatory(
  record: SignatoryRecordCandidate,
  name: string,
): FrozenSignatory {
  const authorizedAt = new Date(record.authorizedAt);
  return {
    recordId: record.id,
    name,
    title: record.title?.trim() || null,
    assetTypeId: record.assetTypeId,
    scopeDescription: record.scopeDescription?.trim() || null,
    authorizedAt: Number.isNaN(authorizedAt.getTime())
      ? String(record.authorizedAt)
      : authorizedAt.toISOString(),
  };
}

// ── calibrating body ────────────────────────────────────────────────────────

export type CalibratingBodyAddress = {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighbourhood: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
};

/**
 * The legal entity and place that performed the calibration. `source` says
 * where it came from: a unit that declares its own establishment (its own
 * CNPJ), or the organization's profile.
 */
export type FrozenCalibratingBody = CalibratingBodyAddress & {
  source: "unit" | "organization";
  unitId: number | null;
  unitName: string | null;
  legalName: string;
  cnpj: string | null;
};

export type CalibratingBodySource = CalibratingBodyAddress & {
  legalName: string | null;
  cnpj: string | null;
};

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function addressOf(source: CalibratingBodyAddress): CalibratingBodyAddress {
  return {
    street: blankToNull(source.street),
    number: blankToNull(source.number),
    complement: blankToNull(source.complement),
    neighbourhood: blankToNull(source.neighbourhood),
    city: blankToNull(source.city),
    state: blankToNull(source.state),
    cep: blankToNull(source.cep),
  };
}

/**
 * The calibrating body of a job. A unit that declares its own CNPJ is a
 * distinct establishment (a branch): ITS legal name, CNPJ and address are used
 * as a block, never mixed with the organization's, because a branch with a
 * missing address must not borrow the head office's. Otherwise the
 * organization's profile is the calibrating body.
 */
export function resolveCalibratingBody(params: {
  organization: CalibratingBodySource & { name: string | null };
  unit: (CalibratingBodySource & { id: number; name: string }) | null;
}): FrozenCalibratingBody {
  const { organization, unit } = params;
  if (unit && blankToNull(unit.cnpj)) {
    return {
      source: "unit",
      unitId: unit.id,
      unitName: unit.name,
      legalName:
        blankToNull(unit.legalName) ??
        blankToNull(organization.legalName) ??
        blankToNull(organization.name) ??
        unit.name,
      cnpj: blankToNull(unit.cnpj),
      ...addressOf(unit),
    };
  }
  return {
    source: "organization",
    unitId: unit?.id ?? null,
    unitName: unit?.name ?? null,
    legalName:
      blankToNull(organization.legalName) ??
      blankToNull(organization.name) ??
      "Laboratório de Calibração",
    cnpj: blankToNull(organization.cnpj),
    ...addressOf(organization),
  };
}

/** One print-ready address line, "Rua X, 10 — Bairro — Cidade/UF — CEP", or null. */
export function calibratingBodyAddressText(
  body: CalibratingBodyAddress,
): string | null {
  const line = [
    [body.street, body.number].filter(Boolean).join(", "),
    body.complement,
    body.neighbourhood,
  ]
    .filter(Boolean)
    .join(" — ");
  const place = [[body.city, body.state].filter(Boolean).join("/"), body.cep]
    .filter(Boolean)
    .join(" — ");
  const full = [line, place].filter(Boolean).join(" — ");
  return full || null;
}

// ── traceability ────────────────────────────────────────────────────────────

/**
 * What the standards data records about who calibrated the standard: the
 * provider's accreditation number, and whether the provider is accredited by a
 * body that signed the ILAC MRA (Cgcre/RBC in Brazil). Both are the lab's own
 * entry on the standard, frozen in the job's standards snapshot.
 */
export type CalibrationProviderFacts = {
  accreditationNumber?: string | null;
  mraRecognized?: boolean | null;
};

export type TraceabilityStandard = {
  id: number;
  name: string;
  certificateNumber: string;
  calibratedBy?: string | null;
  calibrationDate: Date | string;
  nextCalibrationDate?: Date | string | null;
  calibrationProvider?: CalibrationProviderFacts | null;
};

export const TRACEABILITY_FAILURE_REASONS = [
  "no_standards",
  "no_certificate_number",
  "no_calibration_provider",
  "provider_not_accredited",
  "certificate_not_valid_on_calibration_day",
] as const;
export type TraceabilityFailureReason =
  (typeof TRACEABILITY_FAILURE_REASONS)[number];

export type FrozenTraceability = {
  /** True only when every standard used passed every check. */
  verified: boolean;
  /** The instant the decision was taken (the approval instant). */
  evaluatedAt: string;
  /** Distinct calibration providers (name and accreditation), when verified. */
  providers: Array<{ name: string; accreditationNumber: string }>;
  /** Why it is not verified; empty when it is. `standardId` null = job-wide. */
  failures: Array<{
    standardId: number | null;
    reason: TraceabilityFailureReason;
  }>;
};

function dayKeyOf(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const day = calendarDateFromKey(value);
    return day ? calendarDateKey(day) : null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : calendarDateKey(date);
}

/**
 * Decides whether SI traceability may be asserted (ILAC P10; ISO/IEC 17025
 * §6.5.1). Every standard must carry a certificate number, name its calibration
 * provider, have that provider recorded as accredited by an ILAC-MRA signatory
 * with an accreditation number, and have a certificate valid on the day of the
 * calibration (`calibrationDate <= day <= nextCalibrationDate`, laboratory
 * calendar days). Anything missing means "not verified": the certificate then
 * omits the sentence rather than asserting it.
 */
export function evaluateTraceability(params: {
  standards: readonly TraceabilityStandard[] | null | undefined;
  performedAt: Date | string | null | undefined;
  evaluatedAt: Date;
}): FrozenTraceability {
  const standards = params.standards ?? [];
  const failures: FrozenTraceability["failures"] = [];
  const providers = new Map<string, string>();
  const performed =
    params.performedAt instanceof Date
      ? params.performedAt
      : params.performedAt
        ? new Date(params.performedAt)
        : null;
  const performedDay =
    performed && !Number.isNaN(performed.getTime())
      ? labCalendarDayKey(performed)
      : null;

  if (standards.length === 0) {
    failures.push({ standardId: null, reason: "no_standards" });
  }

  for (const standard of standards) {
    const fail = (reason: TraceabilityFailureReason) =>
      failures.push({ standardId: standard.id, reason });

    if (!blankToNull(standard.certificateNumber)) {
      fail("no_certificate_number");
    }
    const providerName = blankToNull(standard.calibratedBy);
    if (!providerName) {
      fail("no_calibration_provider");
    } else {
      const accreditation = blankToNull(
        standard.calibrationProvider?.accreditationNumber,
      );
      if (
        standard.calibrationProvider?.mraRecognized !== true ||
        !accreditation
      ) {
        fail("provider_not_accredited");
      } else {
        providers.set(providerName, accreditation);
      }
    }

    const from = dayKeyOf(standard.calibrationDate);
    const through = dayKeyOf(standard.nextCalibrationDate);
    if (
      performedDay === null ||
      from === null ||
      through === null ||
      performedDay < from ||
      performedDay > through
    ) {
      fail("certificate_not_valid_on_calibration_day");
    }
  }

  const verified = failures.length === 0;
  return {
    verified,
    evaluatedAt: params.evaluatedAt.toISOString(),
    providers: verified
      ? [...providers.entries()]
          .map(([name, accreditationNumber]) => ({ name, accreditationNumber }))
          .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      : [],
    failures,
  };
}
