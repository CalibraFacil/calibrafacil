import { db } from "@calibra-facil/db";
import { referenceStandard } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField } from "./api";
import type { SeedContext } from "./context";

const DAY_MS = 86_400_000;

type Point = {
  reference: number;
  indication: number;
  correction: number;
  uncertainty: number;
  unit: string;
};

type Channel = {
  key: string;
  label: string;
  quantity: string;
  unit: string;
  points: readonly Point[];
};

type CertifiedValue = {
  nominal: string;
  value: number;
  uncertainty: number;
  unit: string;
  maxError: number;
  coverageFactor: number;
};

export type StandardKey =
  | "pesos-e2"
  | "pesos-f1"
  | "pesos-m1"
  | "calibrador"
  | "celula-carga"
  | "tacometro"
  | "termohigrometro"
  | "termometro"
  | "balanca-ref";

type StandardSpec = {
  key: StandardKey;
  name: string;
  kind:
    | "mass_set"
    | "electrical"
    | "force_torque"
    | "rpm"
    | "thermohygrometer"
    | "thermometer"
    | "generic_scalar";
  type: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  certificateNumber: string;
  calibratedBy: string;
  /** Days before "now" the standard was calibrated. */
  calibratedDaysAgo: number;
  /** Days from "now" until the calibration lapses (the dashboard watches 30). */
  validForDays: number;
  certifiedValues?: readonly CertifiedValue[];
  channels?: readonly Channel[];
  referenceValue?: number;
  uncertainty?: number;
  uncertaintyUnit?: string;
  drift?: number;
};

// OIML R 111-1 maximum permissible errors, E2 class, in milligrams. The expanded
// uncertainty on a certificate is taken as mpe/3 (k = 2), as is common practice.
const E2_MPE_MG: ReadonlyArray<readonly [string, number, number]> = [
  ["1 mg", 0.001, 0.006],
  ["2 mg", 0.002, 0.006],
  ["5 mg", 0.005, 0.008],
  ["10 mg", 0.01, 0.01],
  ["20 mg", 0.02, 0.012],
  ["50 mg", 0.05, 0.016],
  ["100 mg", 0.1, 0.02],
  ["200 mg", 0.2, 0.025],
  ["500 mg", 0.5, 0.03],
  ["1 g", 1, 0.04],
  ["2 g", 2, 0.05],
  ["5 g", 5, 0.06],
  ["10 g", 10, 0.08],
  ["20 g", 20, 0.1],
  ["50 g", 50, 0.12],
  ["100 g", 100, 0.16],
  ["200 g", 200, 0.3],
  ["500 g", 500, 0.8],
  ["1 kg", 1000, 1.6],
];

/** Fixed, small conventional-mass corrections (g per g of nominal) so values differ from nominal. */
const CORRECTION_PATTERN = [
  0.00000012, -0.00000008, 0.00000015, -0.00000005, 0.0000001, -0.00000011,
  0.00000007,
];

function massSet(
  rows: ReadonlyArray<readonly [string, number, number]>,
  uncertaintyScale: number,
  maxErrorScale: number,
): CertifiedValue[] {
  return rows.map(([nominal, nominalG, mpeMg], index) => {
    const delta = CORRECTION_PATTERN[index % CORRECTION_PATTERN.length] ?? 0;
    return {
      nominal,
      value: Number((nominalG * (1 + delta)).toFixed(7)),
      uncertainty: Number(
        ((mpeMg / 3 / 1000) * uncertaintyScale).toPrecision(3),
      ),
      unit: "g",
      maxError: Number(((mpeMg / 1000) * maxErrorScale).toPrecision(3)),
      coverageFactor: 2,
    };
  });
}

const F1_ROWS: ReadonlyArray<readonly [string, number, number]> = [
  ["1 g", 1, 0.12],
  ["2 g", 2, 0.16],
  ["5 g", 5, 0.2],
  ["10 g", 10, 0.25],
  ["20 g", 20, 0.3],
  ["50 g", 50, 0.4],
  ["100 g", 100, 0.5],
  ["200 g", 200, 1],
  ["500 g", 500, 2.5],
  ["1 kg", 1000, 5],
  ["2 kg", 2000, 10],
  ["5 kg", 5000, 25],
];

const M1_ROWS: ReadonlyArray<readonly [string, number, number]> = [
  ["1 kg", 1000, 50],
  ["2 kg", 2000, 100],
  ["5 kg", 5000, 250],
  ["10 kg", 10000, 500],
  ["20 kg", 20000, 1000],
];

function point(
  reference: number,
  correction: number,
  uncertainty: number,
  unit: string,
): Point {
  return {
    reference,
    indication: Number((reference - correction).toPrecision(10)),
    correction,
    uncertainty,
    unit,
  };
}

const LAB_NAME = "Laboratório de Referência Metrológica Exemplo";

const SPECS: readonly StandardSpec[] = [
  {
    key: "pesos-e2",
    name: "Jogo de Pesos Padrão E2 (1 mg a 1 kg)",
    kind: "mass_set",
    type: "Peso Padrão",
    serialNumber: "E2-48213",
    manufacturer: "Coel",
    model: "Jogo E2 19 pesos",
    certificateNumber: "LRM-0412/26",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 118,
    validForDays: 247,
    certifiedValues: massSet(E2_MPE_MG, 1, 1),
  },
  {
    key: "pesos-f1",
    name: "Jogo de Pesos Padrão F1 (1 g a 5 kg)",
    kind: "mass_set",
    type: "Peso Padrão",
    serialNumber: "F1-77120",
    manufacturer: "Alfa Mirage",
    model: "Jogo F1 12 pesos",
    certificateNumber: "LRM-0233/25",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 353,
    validForDays: 12,
    certifiedValues: massSet(F1_ROWS, 1, 1),
  },
  {
    key: "pesos-m1",
    name: "Pesos Padrão M1 (1 kg a 20 kg)",
    kind: "mass_set",
    type: "Peso Padrão",
    serialNumber: "M1-30981",
    manufacturer: "Coel",
    model: "Jogo M1 5 pesos",
    certificateNumber: "LRM-0388/26",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 140,
    validForDays: 225,
    certifiedValues: massSet(M1_ROWS, 1, 1),
  },
  {
    key: "calibrador",
    name: "Calibrador Multifunção 6½ dígitos",
    kind: "electrical",
    type: "Calibrador",
    serialNumber: "MF-5521904",
    manufacturer: "Fluke",
    model: "5522A",
    certificateNumber: "LRM-0501/26",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 150,
    validForDays: 215,
    channels: [
      {
        key: "vcc",
        label: "Tensão contínua",
        quantity: "voltage",
        unit: "V",
        points: [
          point(0.1, -0.0000008, 0.0000022, "V"),
          point(1, -0.000004, 0.000009, "V"),
          point(10, 0.00002, 0.00004, "V"),
          point(100, -0.00012, 0.00032, "V"),
        ],
      },
    ],
  },
  {
    key: "celula-carga",
    name: "Célula de Carga de Referência 50 kN",
    kind: "force_torque",
    type: "Célula de carga",
    serialNumber: "CC-2209-0471",
    manufacturer: "HBM",
    model: "C6A/50kN",
    certificateNumber: "LRM-0187/25",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 338,
    validForDays: 27,
    channels: [
      {
        key: "forca",
        label: "Força de compressão",
        quantity: "force",
        unit: "N",
        points: [
          point(500, 0.12, 0.35, "N"),
          point(5000, -0.8, 2.4, "N"),
          point(20000, 3.1, 9.5, "N"),
          point(50000, -7.4, 24, "N"),
        ],
      },
    ],
  },
  {
    key: "tacometro",
    name: "Tacômetro Padrão Óptico",
    kind: "rpm",
    type: "Tacômetro",
    serialNumber: "TP-114207",
    manufacturer: "Monarch",
    model: "PLT200",
    certificateNumber: "LRM-0455/26",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 130,
    validForDays: 235,
    channels: [
      {
        key: "rotacao",
        label: "Rotação",
        quantity: "frequency",
        unit: "rpm",
        points: [
          point(100, 0.01, 0.03, "rpm"),
          point(1500, -0.04, 0.12, "rpm"),
          point(10000, 0.3, 0.8, "rpm"),
        ],
      },
    ],
  },
  {
    key: "termohigrometro",
    name: "Termohigrômetro Padrão (ponto de orvalho)",
    kind: "thermohygrometer",
    type: "Termohigrômetro",
    serialNumber: "VH-80341",
    manufacturer: "Vaisala",
    model: "HMT330",
    certificateNumber: "LRM-0151/25",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 360,
    validForDays: 5,
    channels: [
      {
        key: "temperatura",
        label: "Temperatura",
        quantity: "temperature",
        unit: "°C",
        points: [
          point(15, 0.04, 0.08, "°C"),
          point(23, -0.02, 0.07, "°C"),
          point(30, 0.05, 0.09, "°C"),
        ],
      },
      {
        key: "umidade",
        label: "Umidade relativa",
        quantity: "humidity",
        unit: "%RH",
        points: [
          point(30, 0.3, 0.9, "%RH"),
          point(50, -0.2, 0.9, "%RH"),
          point(70, 0.4, 1.1, "%RH"),
        ],
      },
    ],
  },
  {
    key: "termometro",
    name: "Termômetro Padrão PT100",
    kind: "thermometer",
    type: "Termômetro",
    serialNumber: "PT-20418",
    manufacturer: "Presys",
    model: "TTI-22",
    certificateNumber: "LRM-0469/26",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 140,
    validForDays: 225,
    channels: [
      {
        key: "temperatura",
        label: "Temperatura",
        quantity: "temperature",
        unit: "°C",
        points: [
          point(0, 0.012, 0.03, "°C"),
          point(25, -0.008, 0.03, "°C"),
          point(50, 0.015, 0.04, "°C"),
          point(100, -0.02, 0.05, "°C"),
        ],
      },
    ],
  },
  {
    key: "balanca-ref",
    name: "Balança Analítica de Referência 220 g",
    kind: "generic_scalar",
    type: "Balança de referência",
    serialNumber: "BR-6620931",
    manufacturer: "Mettler Toledo",
    model: "XPR205",
    certificateNumber: "LRM-0420/26",
    calibratedBy: LAB_NAME,
    calibratedDaysAgo: 150,
    validForDays: 215,
    referenceValue: 100,
    uncertainty: 0.00009,
    uncertaintyUnit: "g",
    drift: 0.00004,
  },
];

export type StandardIds = Map<StandardKey, number>;

/** Registers the reference standards through the real route. */
export async function seedStandards(ctx: SeedContext): Promise<StandardIds> {
  const ids: StandardIds = new Map();
  for (const spec of SPECS) {
    const [existing] = await db
      .select({ id: referenceStandard.id })
      .from(referenceStandard)
      .where(
        and(
          eq(referenceStandard.organizationId, LAB_ID),
          eq(referenceStandard.serialNumber, spec.serialNumber),
        ),
      )
      .limit(1);
    if (existing) {
      ids.set(spec.key, existing.id);
      continue;
    }
    const calibrationDate = new Date(
      ctx.now.getTime() - spec.calibratedDaysAgo * DAY_MS,
    );
    const nextCalibrationDate = new Date(
      ctx.now.getTime() + spec.validForDays * DAY_MS,
    );
    const metrologyData = spec.channels
      ? {
          version: 1,
          channels: spec.channels.map((channel) => ({
            ...channel,
            points: channel.points.map((entry) => ({
              ...entry,
              coverageFactor: 2,
              degreesOfFreedomOperator: "exact",
            })),
          })),
          massValues: [],
          compositionProfiles: [],
        }
      : undefined;
    const created = await ctx.api.call("owner", "POST", "/api/standards", {
      name: spec.name,
      kind: spec.kind,
      type: spec.type,
      serialNumber: spec.serialNumber,
      manufacturer: spec.manufacturer,
      model: spec.model,
      certificateNumber: spec.certificateNumber,
      calibratedBy: spec.calibratedBy,
      calibrationDate: calibrationDate.toISOString(),
      nextCalibrationDate: nextCalibrationDate.toISOString(),
      referenceValue: spec.referenceValue,
      uncertainty: spec.uncertainty,
      uncertaintyUnit: spec.uncertaintyUnit,
      coverageFactor: 2,
      distribution: "normal",
      drift: spec.drift,
      certifiedValues: spec.certifiedValues,
      metrologyData,
      status: "ACTIVE",
    });
    const id = numberField(created, "id");
    ids.set(spec.key, id);
    ctx.log(
      `  standard ${spec.key} -> #${id} (valid ${spec.validForDays} more days)`,
    );
  }
  return ids;
}
