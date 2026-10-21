/**
 * One table of cases for the standards judgement (REQ-SJ-4). The pure function
 * (`standards-judgement.spec.ts`), the API adapter (Postgres) and the offline
 * adapter (SQLite) are all run over these same rows and must give the same
 * verdict and refusal code, so no runtime can drift from the others.
 *
 * Dates are fixed: `today` is 2026-10-21 12:00 in Sao Paulo, and the standards
 * are valid through D = 2026-10-18 (expired as of today) unless a case says so.
 */
import type {
  StandardsJudgement,
  StandardsJudgementMode,
  StandardsJudgementRefusalCode,
} from "./standards-judgement";

export const JUDGEMENT_TODAY = new Date("2026-10-21T15:00:00.000Z");

/** The last valid day of the "expired" standard, a stored calendar date. */
export const JUDGEMENT_VALID_THROUGH = "2026-10-18";

/** A certificate that is still valid today. */
const FUTURE = "2027-03-01";

export type JudgementFixtureStandard = {
  /** Stands for the standard's id and is its name. */
  key: string;
  status?: "ACTIVE" | "INACTIVE";
  deleted?: boolean;
  nextCalibrationDate: string | null;
  /**
   * Where the standard lives: the caller's organization (default), another
   * organization, or nowhere (the id is simply unknown).
   */
  world?: "same_org" | "other_org" | "absent";
};

export type StandardsJudgementFixture = {
  name: string;
  mode: StandardsJudgementMode;
  performedAt: string | null;
  backdateReason?: string | null;
  requireBackdateReason?: boolean;
  standards: JudgementFixtureStandard[];
  expected:
    | {
        ok: true;
        reasonRequired: boolean;
        /** The instant judged at: the performed date or "today". */
        judgedAt: "performed" | "today";
      }
    | {
        ok: false;
        code: StandardsJudgementRefusalCode;
        /** The keys of the offending standards. */
        offending: string[];
      };
};

const D = JUDGEMENT_VALID_THROUGH;
// 23:30 on D in Sao Paulo (UTC-3) is 02:30Z the next day; 00:10 on D+1 is 03:10Z.
const D_2330 = "2026-10-19T02:30:00.000Z";
const D_PLUS_1_0010 = "2026-10-19T03:10:00.000Z";
const D_2359 = "2026-10-19T02:59:59.000Z";
const YESTERDAY = "2026-10-20T15:00:00.000Z";

export const STANDARDS_JUDGEMENT_FIXTURES: StandardsJudgementFixture[] = [
  {
    name: "cloud: valid today, performed yesterday, needs no reason",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [{ key: "M1", nextCalibrationDate: FUTURE }],
    expected: { ok: true, reasonRequired: false, judgedAt: "performed" },
  },
  {
    name: "cloud: no standards at all",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [],
    expected: { ok: true, reasonRequired: false, judgedAt: "performed" },
  },
  {
    name: "cloud: valid on its last day D at 23:30 but expired today, with a reason",
    mode: "cloud",
    performedAt: D_2330,
    backdateReason: "Lancamento tardio do dia da calibracao",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: true, reasonRequired: true, judgedAt: "performed" },
  },
  {
    name: "cloud: valid on D at 23:59:59 in Sao Paulo, with a reason",
    mode: "cloud",
    performedAt: D_2359,
    backdateReason: "Lancamento tardio",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: true, reasonRequired: true, judgedAt: "performed" },
  },
  {
    name: "cloud: valid on D but expired today, no reason: refused",
    mode: "cloud",
    performedAt: D_2330,
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: {
      ok: false,
      code: "standard_backdate_reason_required",
      offending: ["M1"],
    },
  },
  {
    name: "cloud: a blank reason is no reason",
    mode: "cloud",
    performedAt: D_2330,
    backdateReason: "   ",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: {
      ok: false,
      code: "standard_backdate_reason_required",
      offending: ["M1"],
    },
  },
  {
    name: "cloud draft save: valid on D but expired today needs no reason yet",
    mode: "cloud",
    performedAt: D_2330,
    requireBackdateReason: false,
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: true, reasonRequired: true, judgedAt: "performed" },
  },
  {
    name: "cloud: D+1 at 00:10 is expired, reason or not",
    mode: "cloud",
    performedAt: D_PLUS_1_0010,
    backdateReason: "Lancamento tardio",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: false, code: "standard_expired", offending: ["M1"] },
  },
  {
    name: "cloud: an unreadable next calibration date is never valid",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [{ key: "M1", nextCalibrationDate: null }],
    expected: { ok: false, code: "standard_expired", offending: ["M1"] },
  },
  {
    name: "cloud: an inactive standard is refused",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [{ key: "M1", status: "INACTIVE", nextCalibrationDate: FUTURE }],
    expected: { ok: false, code: "standard_inactive", offending: ["M1"] },
  },
  {
    name: "cloud: a soft-deleted standard is refused",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [{ key: "M1", deleted: true, nextCalibrationDate: FUTURE }],
    expected: { ok: false, code: "standard_deleted", offending: ["M1"] },
  },
  {
    name: "cloud: a deleted and inactive standard reads as deleted",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [
      {
        key: "M1",
        deleted: true,
        status: "INACTIVE",
        nextCalibrationDate: FUTURE,
      },
    ],
    expected: { ok: false, code: "standard_deleted", offending: ["M1"] },
  },
  {
    name: "cloud: an unknown standard id is not found",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [
      { key: "M1", nextCalibrationDate: FUTURE },
      { key: "GHOST", nextCalibrationDate: FUTURE, world: "absent" },
    ],
    expected: {
      ok: false,
      code: "standard_not_found",
      offending: ["GHOST"],
    },
  },
  {
    name: "cloud: another organization's standard is not found",
    mode: "cloud",
    performedAt: YESTERDAY,
    standards: [
      { key: "FOREIGN", nextCalibrationDate: FUTURE, world: "other_org" },
    ],
    expected: {
      ok: false,
      code: "standard_not_found",
      offending: ["FOREIGN"],
    },
  },
  {
    name: "cloud: only the offending standard of several is reported",
    mode: "cloud",
    performedAt: D_PLUS_1_0010,
    standards: [
      { key: "OK", nextCalibrationDate: FUTURE },
      { key: "OLD", nextCalibrationDate: D },
    ],
    expected: { ok: false, code: "standard_expired", offending: ["OLD"] },
  },
  {
    name: "public API: valid today is judged now",
    mode: "public_api",
    performedAt: null,
    standards: [{ key: "M1", nextCalibrationDate: FUTURE }],
    expected: { ok: true, reasonRequired: false, judgedAt: "today" },
  },
  {
    name: "public API: expired today is refused even when a past performed date and reason are around",
    mode: "public_api",
    performedAt: D_2330,
    backdateReason: "Lancamento tardio",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: false, code: "standard_expired", offending: ["M1"] },
  },
  {
    name: "public API: an inactive standard is refused",
    mode: "public_api",
    performedAt: null,
    standards: [{ key: "M1", status: "INACTIVE", nextCalibrationDate: FUTURE }],
    expected: { ok: false, code: "standard_inactive", offending: ["M1"] },
  },
  {
    name: "desktop with an explicit performed date: valid on D, with a reason",
    mode: "desktop_explicit",
    performedAt: D_2330,
    backdateReason: "Registro do dia da calibracao",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: true, reasonRequired: true, judgedAt: "performed" },
  },
  {
    name: "desktop with an explicit performed date: valid on D, no reason: refused",
    mode: "desktop_explicit",
    performedAt: D_2330,
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: {
      ok: false,
      code: "standard_backdate_reason_required",
      offending: ["M1"],
    },
  },
  {
    name: "desktop with an explicit performed date: D+1 at 00:10 is expired",
    mode: "desktop_explicit",
    performedAt: D_PLUS_1_0010,
    backdateReason: "Registro do dia da calibracao",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: false, code: "standard_expired", offending: ["M1"] },
  },
  {
    name: "legacy desktop event: judged at sync time, so a standard valid only on D is expired",
    mode: "desktop_legacy",
    performedAt: D_2330,
    backdateReason: "Registro do dia da calibracao",
    standards: [{ key: "M1", nextCalibrationDate: D }],
    expected: { ok: false, code: "standard_expired", offending: ["M1"] },
  },
  {
    name: "legacy desktop event: a standard valid today is accepted, judged at sync time",
    mode: "desktop_legacy",
    performedAt: null,
    standards: [{ key: "M1", nextCalibrationDate: FUTURE }],
    expected: { ok: true, reasonRequired: false, judgedAt: "today" },
  },
  {
    name: "legacy desktop event: an inactive standard is refused",
    mode: "desktop_legacy",
    performedAt: null,
    standards: [{ key: "M1", status: "INACTIVE", nextCalibrationDate: FUTURE }],
    expected: { ok: false, code: "standard_inactive", offending: ["M1"] },
  },
];

/** The id each fixture standard is stored under in every runtime. */
export function fixtureStandardIds(
  fixture: StandardsJudgementFixture,
): Map<string, number> {
  return new Map(
    fixture.standards.map((standard, index) => [standard.key, index + 1]),
  );
}

/** The fixture's input for `judgeExecutionStandards` (and its adapters). */
export function fixtureJudgementInput(fixture: StandardsJudgementFixture) {
  const ids = fixtureStandardIds(fixture);
  return {
    standardIds: fixture.standards.map(
      (standard) => ids.get(standard.key) ?? 0,
    ),
    performedAt: fixture.performedAt ? new Date(fixture.performedAt) : null,
    today: JUDGEMENT_TODAY,
    backdateReason: fixture.backdateReason,
    mode: fixture.mode,
    requireBackdateReason: fixture.requireBackdateReason,
  };
}

/**
 * A judgement reduced to what the table asserts, so every runtime's result is
 * compared with `fixture.expected` the same way.
 */
export function summarizeJudgement(
  fixture: StandardsJudgementFixture,
  result: StandardsJudgement,
): StandardsJudgementFixture["expected"] {
  if (!result.ok) {
    const keysById = new Map(
      [...fixtureStandardIds(fixture)].map(([key, id]) => [id, key]),
    );
    return {
      ok: false,
      code: result.code,
      offending: result.standardIds.map((id) => keysById.get(id) ?? `#${id}`),
    };
  }
  return {
    ok: true,
    reasonRequired: result.reasonRequired,
    judgedAt:
      result.standardsJudgedAt.getTime() === JUDGEMENT_TODAY.getTime()
        ? "today"
        : "performed",
  };
}
