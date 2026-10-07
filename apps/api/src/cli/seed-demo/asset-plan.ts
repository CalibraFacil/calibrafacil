import { DEMO_CUSTOMERS } from "./customers";
import type { Rng } from "./prng";

export type AssetTypeSlug =
  | "balanca-digital"
  | "multimetro-digital"
  | "dinamometro"
  | "tacometro"
  | "termohigrometro"
  | "vidraria-volumetrica"
  | "paquimetro"
  | "micrometro"
  | "manometro"
  | "termometro-digital"
  | "termometro-liquido-vidro"
  | "relogio-comparador"
  | "peso-padrao"
  | "torquimetro";

export type PlannedAsset = {
  typeSlug: AssetTypeSlug;
  customerCode: string;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  tag: string;
  specifications: Record<string, string | number>;
  /** Unit the instrument indicates in (drives unit normalisation of results). */
  baseMeasurementUnit: "g" | null;
  /** Customer-owned recalibration interval. */
  intervalMonths: number;
  status: "ACTIVE" | "MAINTENANCE" | "INACTIVE";
};

type Built = Pick<
  PlannedAsset,
  | "name"
  | "manufacturer"
  | "model"
  | "specifications"
  | "baseMeasurementUnit"
  | "serialNumber"
>;

/** How many instruments of each type the demo park holds. */
export const ASSET_COUNTS: Readonly<Record<AssetTypeSlug, number>> = {
  "balanca-digital": 104,
  "multimetro-digital": 18,
  dinamometro: 11,
  tacometro: 13,
  termohigrometro: 20,
  "vidraria-volumetrica": 14,
  paquimetro: 12,
  micrometro: 6,
  manometro: 10,
  "termometro-digital": 6,
  "termometro-liquido-vidro": 4,
  "relogio-comparador": 3,
  "peso-padrao": 4,
  torquimetro: 4,
};

const TYPE_CODE: Readonly<Record<AssetTypeSlug, string>> = {
  "balanca-digital": "BAL",
  "multimetro-digital": "MUL",
  dinamometro: "DIN",
  tacometro: "TAC",
  termohigrometro: "THG",
  "vidraria-volumetrica": "VID",
  paquimetro: "PAQ",
  micrometro: "MIC",
  manometro: "MAN",
  "termometro-digital": "TDG",
  "termometro-liquido-vidro": "TLV",
  "relogio-comparador": "RCP",
  "peso-padrao": "PPD",
  torquimetro: "TRQ",
};

/** Customer weights per type, in DEMO_CUSTOMERS order (LCB MHA LES FIR CPS UPT). */
const AFFINITY: Readonly<Record<AssetTypeSlug, readonly number[]>> = {
  "balanca-digital": [24, 16, 18, 22, 14, 6],
  "multimetro-digital": [5, 30, 10, 15, 5, 35],
  dinamometro: [0, 45, 0, 0, 5, 50],
  tacometro: [10, 40, 0, 5, 15, 30],
  termohigrometro: [25, 10, 25, 30, 8, 2],
  "vidraria-volumetrica": [10, 0, 40, 35, 15, 0],
  paquimetro: [5, 35, 0, 0, 10, 50],
  micrometro: [0, 40, 0, 0, 0, 60],
  manometro: [25, 40, 0, 15, 10, 10],
  "termometro-digital": [35, 10, 20, 20, 15, 0],
  "termometro-liquido-vidro": [30, 0, 25, 25, 20, 0],
  "relogio-comparador": [0, 50, 0, 0, 0, 50],
  "peso-padrao": [10, 10, 30, 30, 10, 10],
  torquimetro: [0, 45, 0, 0, 0, 55],
};

const ALNUM = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

function serial(rng: Rng, prefix: string, digits: number): string {
  let body = "";
  for (let i = 0; i < digits; i += 1) body += String(rng.int(0, 9));
  return `${prefix}${body}`;
}

function alnumSerial(rng: Rng, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALNUM.charAt(rng.int(0, ALNUM.length - 1));
  }
  return out;
}

type BalanceVariant = {
  label: string;
  capacityG: number;
  resolutionG: number;
  models: ReadonlyArray<readonly [string, string]>;
  weight: number;
};

const BALANCE_VARIANTS: readonly BalanceVariant[] = [
  {
    label: "Balança Analítica",
    capacityG: 220,
    resolutionG: 0.0001,
    models: [
      ["Marte", "AUY220"],
      ["Shimadzu", "ATX224"],
      ["Mettler Toledo", "ML204T"],
      ["Ohaus", "PX224"],
    ],
    weight: 20,
  },
  {
    label: "Balança Analítica",
    capacityG: 120,
    resolutionG: 0.0001,
    models: [
      ["Shimadzu", "AUW120D"],
      ["Bel Engineering", "M124Ai"],
    ],
    weight: 8,
  },
  {
    label: "Balança Semi-analítica",
    capacityG: 620,
    resolutionG: 0.001,
    models: [
      ["Shimadzu", "UX620H"],
      ["Ohaus", "PX623"],
      ["Bel Engineering", "L503i"],
    ],
    weight: 14,
  },
  {
    label: "Balança de Precisão",
    capacityG: 3200,
    resolutionG: 0.01,
    models: [
      ["Marte", "AD3300"],
      ["Shimadzu", "UX3200H"],
      ["Ohaus", "SPX3202"],
    ],
    weight: 18,
  },
  {
    label: "Balança de Precisão",
    capacityG: 6200,
    resolutionG: 0.01,
    models: [
      ["Gehaka", "BK6000"],
      ["Marte", "AD6202"],
    ],
    weight: 12,
  },
  {
    label: "Balança de Bancada",
    capacityG: 15000,
    resolutionG: 0.1,
    models: [
      ["Toledo do Brasil", "Prix 3 Plus"],
      ["Filizola", "BP-15"],
      ["Welmy", "W15"],
    ],
    weight: 16,
  },
  {
    label: "Balança de Bancada",
    capacityG: 30000,
    resolutionG: 1,
    models: [
      ["Toledo do Brasil", "Prix 4 Uno"],
      ["Filizola", "ID-M 30"],
    ],
    weight: 12,
  },
];

function buildBalance(rng: Rng): Built {
  const variant = rng.weighted(
    BALANCE_VARIANTS,
    BALANCE_VARIANTS.map((entry) => entry.weight),
  );
  const [manufacturer, model] = rng.pick(variant.models);
  const specifications: Record<string, string | number> = {
    capacity: variant.capacityG,
    resolution: variant.resolutionG,
    repeatability: variant.resolutionG,
    linearity: variant.resolutionG * 2,
  };
  if (variant.capacityG >= 3000 && rng.chance(0.4)) {
    specifications.portaria = "Portaria Inmetro nº 157/2022";
  }
  return {
    name: `${variant.label} ${manufacturer} ${model}`,
    manufacturer,
    model,
    serialNumber: alnumSerial(rng, 9),
    baseMeasurementUnit: "g",
    specifications,
  };
}

function buildMultimeter(rng: Rng): Built {
  const [manufacturer, model, digits, accuracy] = rng.pick([
    ["Fluke", "8846A", "6½", "0,0024% + 2 dígitos"],
    ["Keysight", "34461A", "6½", "0,0030% + 3 dígitos"],
    ["Agilent", "34401A", "6½", "0,0040% + 3 dígitos"],
    ["Minipa", "ET-2231", "3½", "0,5% + 3 dígitos"],
    ["Fluke", "287", "6½", "0,025% + 5 dígitos"],
    ["Minipa", "ET-2082", "4½", "0,05% + 5 dígitos"],
  ] as const);
  return {
    name: `Multímetro Digital ${manufacturer} ${model}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "MY", 8),
    baseMeasurementUnit: null,
    specifications: {
      displayDigits: digits,
      voltageRangeMax: 1000,
      currentRangeMax: 10,
      resistanceRangeMax: 100,
      accuracyClass: accuracy,
    },
  };
}

function buildDynamometer(rng: Rng): Built {
  const [capacity, resolution] = rng.pick([
    [500, 0.1],
    [1000, 0.5],
    [5000, 1],
    [20000, 5],
    [50000, 10],
  ] as const);
  const [manufacturer, model] = rng.pick([
    ["Instrutherm", "DD-500"],
    ["Kratos", "SF-50"],
    ["Emic", "CT-1000"],
    ["Imada", "DS2-110"],
  ] as const);
  return {
    name: `Dinamômetro ${manufacturer} ${model}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "DN", 7),
    baseMeasurementUnit: null,
    specifications: {
      capacity,
      resolution,
      forceUnit: "N",
      loadMode: rng.pick([
        "Tração",
        "Compressão",
        "Tração/Compressão",
      ] as const),
      accuracyClass: "Classe 1",
    },
  };
}

function buildTachometer(rng: Rng): Built {
  const [manufacturer, model, type, resolution] = rng.pick([
    ["Instrutherm", "TDL-1000", "Óptico", 0.1],
    ["Minipa", "MDT-2238A", "Contato/Óptico", 0.1],
    ["Icel", "TC-5005", "Óptico", 1],
    ["Testo", "470", "Contato/Óptico", 1],
  ] as const);
  return {
    name: `Tacômetro ${type === "Óptico" ? "Óptico" : "Digital"} ${manufacturer} ${model}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "TC", 7),
    baseMeasurementUnit: null,
    specifications: {
      rangeMin: 5,
      rangeMax: 99999,
      resolution,
      instrumentType: type,
    },
  };
}

function buildThermohygrometer(rng: Rng): Built {
  const [manufacturer, model, tMin, tMax] = rng.pick([
    ["Testo", "608-H1", 0, 50],
    ["Incoterm", "7664.02.0.00", -10, 60],
    ["Instrutherm", "HT-260", -20, 70],
    ["Akso", "AK28", 0, 50],
    ["Vaisala", "HM40", -40, 60],
  ] as const);
  return {
    name: `Termohigrômetro Digital ${manufacturer} ${model}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "TH", 8),
    baseMeasurementUnit: null,
    specifications: {
      tempRangeMin: tMin,
      tempRangeMax: tMax,
      tempResolution: 0.1,
      humidityRangeMin: rng.pick([0, 5, 10] as const),
      humidityRangeMax: rng.pick([95, 99, 100] as const),
      humidityResolution: rng.pick([0.1, 1] as const),
    },
  };
}

function buildGlassware(rng: Rng): Built {
  const [kind, volumes, mode, division] = rng.pick([
    ["Balão volumétrico", [50, 100, 250, 500, 1000], "Para conter (TC/In)", 0],
    ["Pipeta volumétrica", [1, 2, 5, 10, 25], "Para dispensar (TD/Ex)", 0],
    ["Bureta", [25, 50], "Para dispensar (TD/Ex)", 0.05],
    ["Proveta", [100, 250, 500], "Para conter (TC/In)", 1],
  ] as const);
  const volume = rng.pick(volumes);
  const manufacturer = rng.pick([
    "Laborglas",
    "Vidrolabor",
    "Satelit",
    "Boeco",
  ] as const);
  const specifications: Record<string, string | number> = {
    nominalVolume: volume,
    instrumentType: kind,
    accuracyClass: rng.pick(["A", "A", "B"] as const),
    calibrationMode: mode,
  };
  if (division > 0) specifications.scaleDivision = division;
  return {
    name: `${kind} ${volume} mL`,
    manufacturer,
    model: `Classe ${String(specifications.accuracyClass)}`,
    serialNumber: `Lote ${rng.int(2201, 2512)}-${alnumSerial(rng, 2)}`,
    baseMeasurementUnit: null,
    specifications,
  };
}

function buildCaliper(rng: Rng): Built {
  const [manufacturer, model] = rng.pick([
    ["Mitutoyo", "500-196-30"],
    ["Digimess", "100.174BL"],
    ["Starrett", "798A-6/150"],
    ["Zaas", "Precision 150"],
  ] as const);
  const digital = rng.chance(0.75);
  const capacity = rng.pick([150, 200, 300] as const);
  return {
    name: `Paquímetro ${digital ? "Digital" : "Analógico"} ${capacity} mm ${manufacturer}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "PQ", 7),
    baseMeasurementUnit: null,
    specifications: {
      capacity,
      resolution: digital ? 0.01 : 0.02,
      instrumentType: digital ? "Digital" : "Analógico",
      jawType: "Universal",
    },
  };
}

function buildMicrometer(rng: Rng): Built {
  const [manufacturer, model] = rng.pick([
    ["Mitutoyo", "103-137"],
    ["Digimess", "110.284"],
    ["Starrett", "T230XRL"],
  ] as const);
  const min = rng.pick([0, 25, 50, 75] as const);
  return {
    name: `Micrômetro Externo ${min}-${min + 25} mm ${manufacturer}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "MC", 7),
    baseMeasurementUnit: null,
    specifications: {
      rangeMin: min,
      rangeMax: min + 25,
      resolution: 0.001,
      instrumentType: "Externo",
    },
  };
}

function buildPressureGauge(rng: Rng): Built {
  const [manufacturer, model] = rng.pick([
    ["Wika", "232.50"],
    ["Famabras", "Fam-63"],
    ["Ashcroft", "1009"],
    ["Zürich", "ZM-100"],
  ] as const);
  const max = rng.pick([6, 10, 16, 25, 60, 100, 250] as const);
  return {
    name: `Manômetro 0-${max} bar ${manufacturer}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "MN", 8),
    baseMeasurementUnit: null,
    specifications: {
      rangeMin: 0,
      rangeMax: max,
      pressureUnit: "bar",
      accuracyClass: rng.pick(["0.5", "1.0", "1.6"] as const),
      dialDiameter: rng.pick([63, 100] as const),
    },
  };
}

function buildDigitalThermometer(rng: Rng): Built {
  const [manufacturer, model, sensor, tMin, tMax] = rng.pick([
    ["Testo", "735-1", "PT100", -50, 400],
    ["Fluke", "51 II", "Termopar K", -200, 1370],
    ["Incoterm", "TD-880", "Termopar K", -50, 750],
    ["Minipa", "MT-600", "Termopar K", -50, 750],
  ] as const);
  return {
    name: `Termômetro Digital ${manufacturer} ${model}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "TD", 8),
    baseMeasurementUnit: null,
    specifications: {
      rangeMin: tMin,
      rangeMax: tMax,
      resolution: 0.1,
      sensorType: sensor,
      channelCount: model === "51 II" ? 1 : 2,
    },
  };
}

function buildGlassThermometer(rng: Rng): Built {
  const division = rng.pick([1, 0.5, 0.1] as const);
  return {
    name: `Termômetro de Mercúrio em Vidro ${division} °C`,
    manufacturer: "Incoterm",
    model: `Cód. ${rng.int(5001, 5099)}`,
    serialNumber: serial(rng, "LV", 6),
    baseMeasurementUnit: null,
    specifications: {
      rangeMin: division === 0.1 ? 0 : -10,
      rangeMax: division === 0.1 ? 50 : 110,
      scaleDivision: division,
      immersionType: "Parcial",
      immersionDepth: 76,
    },
  };
}

function buildDialIndicator(rng: Rng): Built {
  const [manufacturer, model, res] = rng.pick([
    ["Mitutoyo", "2046S", 0.01],
    ["Mitutoyo", "543-390B", 0.001],
    ["Digimess", "121.301", 0.01],
  ] as const);
  return {
    name: `Relógio Comparador ${res} mm ${manufacturer}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "RC", 7),
    baseMeasurementUnit: null,
    specifications: {
      capacity: 10,
      resolution: res,
      instrumentType: res === 0.001 ? "Digital" : "Analógico",
    },
  };
}

function buildWeight(rng: Rng): Built {
  const nominal = rng.pick([100, 500, 1000, 5000] as const);
  const klass = rng.pick(["E2", "F1", "F2"] as const);
  return {
    name: `Peso Padrão ${nominal >= 1000 ? `${nominal / 1000} kg` : `${nominal} g`} ${klass}`,
    manufacturer: rng.pick(["Coel", "Alfa Mirage", "Kern"] as const),
    model: `Classe ${klass}`,
    serialNumber: serial(rng, "PP", 6),
    baseMeasurementUnit: "g",
    specifications: {
      nominalValue: nominal,
      oimlClass: klass,
      material: "Aço inoxidável",
      shape: "Cilíndrico",
    },
  };
}

function buildTorqueWrench(rng: Rng): Built {
  const [manufacturer, model, min, max, drive] = rng.pick([
    ["Gedore", "TORCOFIX K", 20, 100, '1/2"'],
    ["Tohnichi", "CEM100N3X15D", 20, 100, '3/8"'],
    ["Belzer", "7330-100", 20, 100, '1/2"'],
    ["Gedore", "TORCOFIX Z", 5, 25, '1/4"'],
  ] as const);
  return {
    name: `Torquímetro de Estalo ${min}-${max} N·m ${manufacturer}`,
    manufacturer,
    model,
    serialNumber: serial(rng, "TQ", 7),
    baseMeasurementUnit: null,
    specifications: {
      rangeMin: min,
      rangeMax: max,
      resolution: 1,
      instrumentType: "Estalo",
      driveSize: drive,
    },
  };
}

const BUILDERS: Readonly<Record<AssetTypeSlug, (rng: Rng) => Built>> = {
  "balanca-digital": buildBalance,
  "multimetro-digital": buildMultimeter,
  dinamometro: buildDynamometer,
  tacometro: buildTachometer,
  termohigrometro: buildThermohygrometer,
  "vidraria-volumetrica": buildGlassware,
  paquimetro: buildCaliper,
  micrometro: buildMicrometer,
  manometro: buildPressureGauge,
  "termometro-digital": buildDigitalThermometer,
  "termometro-liquido-vidro": buildGlassThermometer,
  "relogio-comparador": buildDialIndicator,
  "peso-padrao": buildWeight,
  torquimetro: buildTorqueWrench,
};

/**
 * The whole instrument park, deterministic for a given generator state: every
 * tag is unique, and each instrument type is concentrated on the customers that
 * plausibly own it (a clinical laboratory has balances and glassware, a
 * machine shop has calipers and micrometers).
 */
export function buildAssetPlan(rng: Rng): PlannedAsset[] {
  const counters = new Map<string, number>();
  const plan: PlannedAsset[] = [];
  const customerCodes = DEMO_CUSTOMERS.map((entry) => entry.code);

  for (const [slug, count] of Object.entries(ASSET_COUNTS)) {
    if (!isAssetTypeSlug(slug)) continue;
    const weights = AFFINITY[slug];
    for (let i = 0; i < count; i += 1) {
      const customerCode = rng.weighted(customerCodes, weights);
      const counterKey = `${customerCode}-${TYPE_CODE[slug]}`;
      const sequence = (counters.get(counterKey) ?? 0) + 1;
      counters.set(counterKey, sequence);
      const built = BUILDERS[slug](rng);
      const intervalMonths =
        slug === "peso-padrao" || slug === "vidraria-volumetrica"
          ? rng.weighted([24, 12], [3, 2])
          : rng.weighted([12, 6, 24], [14, 3, 1]);
      plan.push({
        ...built,
        typeSlug: slug,
        customerCode,
        tag: `${counterKey}-${String(sequence).padStart(3, "0")}`,
        intervalMonths,
        status: "ACTIVE",
      });
    }
  }

  // A few instruments out of service, for the status filters to have something to show.
  const idle = plan.filter(
    (asset) =>
      asset.typeSlug === "paquimetro" ||
      asset.typeSlug === "manometro" ||
      asset.typeSlug === "termometro-digital",
  );
  idle.slice(0, 2).forEach((asset) => {
    asset.status = "MAINTENANCE";
  });
  idle.slice(2, 3).forEach((asset) => {
    asset.status = "INACTIVE";
  });

  return plan;
}

function isAssetTypeSlug(value: string): value is AssetTypeSlug {
  return Object.hasOwn(ASSET_COUNTS, value);
}
