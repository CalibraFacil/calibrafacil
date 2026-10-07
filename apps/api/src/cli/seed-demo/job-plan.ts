import type { Actor } from "./api";
import {
  labTimeOnDay,
  spreadApprovals,
  spreadRejections,
  toWorkingTime,
} from "./dates";
import type { DemoTemplateKey } from "./methods";
import type { Rng } from "./prng";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type JobFinalState =
  | "APPROVED"
  | "REJECTED"
  | "REVIEW"
  | "IN_PROGRESS"
  | "DRAFT";

export type PlannableAsset = {
  tag: string;
  typeSlug: string;
};

export type PlannedJob = {
  /** Position in creation order; job numbers follow it. */
  slot: number;
  assetTag: string;
  templateKey: DemoTemplateKey;
  final: JobFinalState;
  /** Who runs the worksheet and creates the job. */
  technician: Actor;
  /** Who approves or rejects (absent for jobs that never reach review). */
  reviewer?: Actor;
  createdAt: Date;
  dueDate: Date;
  /** Calibration date (set when the worksheet is submitted). */
  performedAt?: Date;
  submittedAt?: Date;
  /** Approval or rejection instant. */
  decidedAt?: Date;
  location: "lab" | "customer_site";
  /** In-progress worksheets are only partly filled: how many test points. */
  filledPoints?: number;
  note?: string;
};

export type PlanSize = {
  approved: number;
  inLast30Days: number;
  minThisMonth: number;
};

export const FULL_PLAN: PlanSize = {
  approved: 112,
  inLast30Days: 88,
  minThisMonth: 12,
};
export const QUICK_PLAN: PlanSize = {
  approved: 30,
  inLast30Days: 24,
  minThisMonth: 6,
};

/**
 * Open work, as the pipeline board shows it: preparation / execution / review.
 * Nothing is left mid-issue: a development API never drains the queue, so a
 * job left "issuing" would stay that way.
 */
export const OPEN_PIPELINE = {
  DRAFT: 5,
  IN_PROGRESS: 8,
  REVIEW: 3,
} as const;
export const REJECTED_COUNT = 3;

const TEMPLATE_BY_TYPE: Readonly<Record<string, DemoTemplateKey>> = {
  "balanca-digital": "weighing-instrument",
  "multimetro-digital": "electrical-indication",
  dinamometro: "force-indication",
  tacometro: "frequency-indication",
};

/** Turnaround, in days, of each method's service. */
const TURNAROUND_DAYS: Readonly<Record<DemoTemplateKey, number>> = {
  "weighing-instrument": 5,
  "electrical-indication": 7,
  "force-indication": 10,
  "frequency-indication": 5,
};

export function templateForAssetType(
  typeSlug: string,
): DemoTemplateKey | undefined {
  return TEMPLATE_BY_TYPE[typeSlug];
}

/** Jobs a lab can run on an instrument type (those with an adopted method). */
export function isCalibratable(typeSlug: string): boolean {
  return typeSlug in TEMPLATE_BY_TYPE;
}

const APPROVAL_NOTES = [
  "Dados conferidos; orçamento de incerteza coerente com o histórico do instrumento.",
  "Revisão técnica concluída sem pendências.",
  "Resultados conferidos contra o certificado dos padrões utilizados.",
  "Aprovado após conferência da planilha e das condições ambientais.",
];

export const REJECTION_REASONS = [
  "Leituras de repetibilidade inconsistentes com o histórico do instrumento; repetir o ensaio de repetibilidade.",
  "Condições ambientais registradas fora do procedimento; repetir a calibração após estabilização do ambiente.",
  "Pontos de calibração insuficientes para a faixa de uso declarada pelo cliente.",
];

/**
 * A technician runs the worksheet; the reviewer (or, for the reviewer's own
 * work, the owner) approves it, so approval is never self-approval. The owner
 * is only qualified on the first two methods.
 */
function pickPeople(
  templateKey: DemoTemplateKey,
  rng: Rng,
): { technician: Actor; reviewer: Actor } {
  const ownerQualified =
    templateKey === "weighing-instrument" ||
    templateKey === "electrical-indication";
  const technician = rng.weighted<Actor>(
    ["technician", "reviewer", "owner"],
    [ownerQualified ? 78 : 86, 14, ownerQualified ? 8 : 0],
  );
  if (technician === "reviewer") return { technician, reviewer: "owner" };
  if (technician === "owner") return { technician, reviewer: "reviewer" };
  return {
    technician,
    reviewer: rng.weighted<Actor>(["reviewer", "owner"], [85, 15]),
  };
}

type Draft = Omit<PlannedJob, "slot" | "technician" | "reviewer"> & {
  reviews: boolean;
};

/** Walks the timeline backwards from the decision: submit, calibration, creation. */
function historicTimeline(decidedAt: Date, rng: Rng, tatDays: number) {
  const submittedAt = toWorkingTime(
    new Date(decidedAt.getTime() - rng.float(1.5, 26) * HOUR_MS),
  );
  const performedAt = toWorkingTime(
    new Date(submittedAt.getTime() - rng.float(0.4, 3) * HOUR_MS),
  );
  const createdAt = toWorkingTime(
    new Date(performedAt.getTime() - rng.float(0.3, 3.5) * DAY_MS),
  );
  const dueDate = new Date(
    createdAt.getTime() + (tatDays + rng.int(0, 2)) * DAY_MS,
  );
  return { createdAt, performedAt, submittedAt, dueDate };
}

/** Due dates of the 16 open jobs: one overdue, a few today, the rest across the next two weeks. */
function openDueOffsets(
  now: Date,
): Array<{ state: "IN_PROGRESS" | "REVIEW" | "DRAFT"; due: Date }> {
  return [
    { state: "IN_PROGRESS", due: labTimeOnDay(now, -2, 17) },
    {
      state: "IN_PROGRESS",
      due: new Date(
        Math.max(
          labTimeOnDay(now, 0, 18).getTime(),
          now.getTime() + 2 * HOUR_MS,
        ),
      ),
    },
    {
      state: "REVIEW",
      due: new Date(
        Math.max(
          labTimeOnDay(now, 0, 23).getTime(),
          now.getTime() + 3 * HOUR_MS,
        ),
      ),
    },
    { state: "REVIEW", due: labTimeOnDay(now, 1, 17) },
    { state: "REVIEW", due: labTimeOnDay(now, 2, 17) },
    { state: "IN_PROGRESS", due: labTimeOnDay(now, 1, 12) },
    { state: "IN_PROGRESS", due: labTimeOnDay(now, 3, 12) },
    { state: "IN_PROGRESS", due: labTimeOnDay(now, 4, 17) },
    { state: "IN_PROGRESS", due: labTimeOnDay(now, 6, 12) },
    { state: "IN_PROGRESS", due: labTimeOnDay(now, 7, 17) },
    { state: "IN_PROGRESS", due: labTimeOnDay(now, 9, 12) },
    { state: "DRAFT", due: labTimeOnDay(now, 5, 12) },
    { state: "DRAFT", due: labTimeOnDay(now, 6, 17) },
    { state: "DRAFT", due: labTimeOnDay(now, 8, 12) },
    { state: "DRAFT", due: labTimeOnDay(now, 10, 17) },
    { state: "DRAFT", due: labTimeOnDay(now, 14, 12) },
  ];
}

/**
 * The whole job history of the demo lab, in creation order (job numbers follow
 * it). Each instrument appears at most once, so no instrument is calibrated
 * twice in a quarter. `assets` must hold at least as many calibratable
 * instruments as the plan has jobs.
 */
export function buildJobPlan(
  now: Date,
  assets: readonly PlannableAsset[],
  size: PlanSize,
  rng: Rng,
): PlannedJob[] {
  const pool = rng.shuffle(
    assets.filter((asset) => isCalibratable(asset.typeSlug)),
  );
  const openCount = Object.values(OPEN_PIPELINE).reduce((sum, n) => sum + n, 0);
  const needed = size.approved + REJECTED_COUNT + openCount;
  if (pool.length < needed) {
    throw new Error(
      `Job plan needs ${needed} calibratable instruments, found ${pool.length}`,
    );
  }

  let cursor = 0;
  const nextAsset = (): { tag: string; templateKey: DemoTemplateKey } => {
    const asset = pool[cursor];
    cursor += 1;
    const templateKey = asset
      ? templateForAssetType(asset.typeSlug)
      : undefined;
    if (!asset || !templateKey) throw new Error("Instrument pool exhausted");
    return { tag: asset.tag, templateKey };
  };

  const drafts: Draft[] = [];

  // Approved history.
  const approvals = spreadApprovals(
    now,
    {
      total: size.approved,
      inLast30Days: size.inLast30Days,
      minThisMonth: size.minThisMonth,
      windowDays: 90,
    },
    rng.fork("approvals"),
  );
  for (const decidedAt of approvals) {
    const { tag, templateKey } = nextAsset();
    drafts.push({
      assetTag: tag,
      templateKey,
      final: "APPROVED",
      ...historicTimeline(decidedAt, rng, TURNAROUND_DAYS[templateKey]),
      decidedAt,
      location: rng.chance(0.12) ? "customer_site" : "lab",
      note: rng.pick(APPROVAL_NOTES),
      reviews: true,
    });
  }

  // Rejections.
  for (const decidedAt of spreadRejections(now, rng.fork("rejections"))) {
    const { tag, templateKey } = nextAsset();
    drafts.push({
      assetTag: tag,
      templateKey,
      final: "REJECTED",
      ...historicTimeline(decidedAt, rng, TURNAROUND_DAYS[templateKey]),
      decidedAt,
      location: "lab",
      note: rng.pick(REJECTION_REASONS),
      reviews: true,
    });
  }

  // Open work: preparation, execution and review, with the due-date mix of a busy week.
  const open = openDueOffsets(now);
  let inProgressIndex = 0;
  for (const { state, due } of open) {
    const { tag, templateKey } = nextAsset();
    const overdue = due.getTime() < now.getTime();
    const ageDays = overdue
      ? rng.float(6, 9)
      : state === "DRAFT"
        ? rng.float(0.3, 2.5)
        : rng.float(0.8, 5);
    const base: Draft = {
      assetTag: tag,
      templateKey,
      final: state,
      createdAt: now,
      dueDate: due,
      location: "lab",
      reviews: state === "REVIEW",
    };
    if (state === "IN_PROGRESS") {
      base.filledPoints = inProgressIndex % 2 === 0 ? undefined : rng.int(1, 3);
      inProgressIndex += 1;
    }
    if (state === "REVIEW") {
      const submittedAt = toWorkingTime(
        new Date(now.getTime() - rng.float(0.7, 20) * HOUR_MS),
      );
      base.submittedAt = submittedAt;
      base.performedAt = toWorkingTime(
        new Date(submittedAt.getTime() - rng.float(0.5, 3) * HOUR_MS),
      );
    }
    // A job under review is aged from its bench work, so it was always opened
    // before the calibration it records, whatever time the seed runs at.
    const agedFrom = base.performedAt ?? now;
    base.createdAt = toWorkingTime(
      new Date(agedFrom.getTime() - ageDays * DAY_MS),
    );
    drafts.push(base);
  }

  const peopleRng = rng.fork("people");
  return drafts
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((draft, slot) => {
      const { reviews, ...job } = draft;
      const people = pickPeople(draft.templateKey, peopleRng);
      return {
        ...job,
        slot,
        technician: people.technician,
        reviewer: reviews ? people.reviewer : undefined,
      };
    });
}
