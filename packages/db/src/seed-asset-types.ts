/**
 * Seed script for ISO 17025 / RBC / Inmetro equipment types.
 * Run this after migration to populate the asset_type table with common calibration instruments.
 *
 * Usage: bun run src/seed-asset-types.ts
 */

import { db } from "./db";
import { assetType, type AssetTypeFieldDefinition } from "./schema";

const assetTypes: Array<{
  name: string;
  slug: string;
  description: string;
  definition: AssetTypeFieldDefinition[];
}> = [
  {
    name: "Balança Digital",
    slug: "balanca-digital",
    description:
      "Balanças analíticas, de precisão e semi-analíticas para medição de massa",
    definition: [
      {
        key: "capacity",
        label: "Capacidade Máxima",
        type: "number",
        unit: "g",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução (d)",
        type: "number",
        unit: "g",
        required: true,
      },
      {
        key: "weighingRanges",
        label: "Faixas de pesagem",
        type: "weighing_ranges",
        required: false,
      },
      {
        key: "portaria",
        label: "Portaria",
        type: "text",
        required: false,
      },
      {
        key: "inmetroRegistration",
        label: "Registro/Aprovação Inmetro",
        type: "text",
        required: false,
      },
      {
        key: "linearity",
        label: "Linearidade",
        type: "number",
        unit: "g",
        required: false,
      },
      {
        key: "repeatability",
        label: "Repetitividade",
        type: "number",
        unit: "g",
        required: false,
      },
    ],
  },
  {
    name: "Termohigrômetro",
    slug: "termohigrometro",
    description: "Instrumentos para medição de temperatura e umidade relativa",
    definition: [
      {
        key: "tempRangeMin",
        label: "Faixa de Temperatura Mín.",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "tempRangeMax",
        label: "Faixa de Temperatura Máx.",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "tempResolution",
        label: "Resolução de Temperatura",
        type: "number",
        unit: "°C",
        required: false,
      },
      {
        key: "humidityRangeMin",
        label: "Faixa de Umidade Mín.",
        type: "number",
        unit: "%RH",
        required: true,
      },
      {
        key: "humidityRangeMax",
        label: "Faixa de Umidade Máx.",
        type: "number",
        unit: "%RH",
        required: true,
      },
      {
        key: "humidityResolution",
        label: "Resolução de Umidade",
        type: "number",
        unit: "%RH",
        required: false,
      },
    ],
  },
  {
    name: "Paquímetro",
    slug: "paquimetro",
    description:
      "Paquímetros analógicos e digitais para medição dimensional linear",
    definition: [
      {
        key: "capacity",
        label: "Capacidade",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Analógico", "Digital"],
        required: true,
      },
      {
        key: "jawType",
        label: "Tipo de Bico",
        type: "select",
        options: ["Universal", "Bico Fino", "Bico Longo"],
        required: false,
      },
    ],
  },
  {
    name: "Micrômetro",
    slug: "micrometro",
    description: "Micrômetros externos e internos para medição dimensional",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Externo", "Interno", "De Profundidade"],
        required: true,
      },
    ],
  },
  {
    name: "Termômetro de Líquido em Vidro",
    slug: "termometro-liquido-vidro",
    description:
      "Termômetros de mercúrio ou líquido orgânico em bulbo de vidro",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "scaleDivision",
        label: "Divisão de Escala",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "immersionDepth",
        label: "Profundidade de Imersão",
        type: "number",
        unit: "mm",
        required: false,
      },
      {
        key: "immersionType",
        label: "Tipo de Imersão",
        type: "select",
        options: ["Total", "Parcial", "Completa"],
        required: false,
      },
    ],
  },
  {
    name: "Manômetro",
    slug: "manometro",
    description:
      "Manômetros analógicos e digitais para medição de pressão positiva",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "bar",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "bar",
        required: true,
      },
      {
        key: "pressureUnit",
        label: "Unidade de Pressão",
        type: "select",
        options: ["bar", "psi", "kPa", "MPa", "kgf/cm²", "mmHg", "inHg"],
        required: true,
      },
      {
        key: "accuracyClass",
        label: "Classe de Exatidão",
        type: "select",
        options: ["0.1", "0.25", "0.5", "1.0", "1.6", "2.5", "4.0"],
        required: false,
      },
      {
        key: "dialDiameter",
        label: "Diâmetro do Mostrador",
        type: "number",
        unit: "mm",
        required: false,
      },
    ],
  },
  {
    name: "Bloco Padrão",
    slug: "bloco-padrao",
    description: "Blocos padrão de aço ou cerâmica para calibração dimensional",
    definition: [
      {
        key: "nominalSize",
        label: "Dimensão Nominal",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "material",
        label: "Material",
        type: "select",
        options: ["Aço", "Cerâmica", "Carboneto de Tungstênio"],
        required: true,
      },
      {
        key: "grade",
        label: "Grau",
        type: "select",
        options: ["K", "0", "1", "2"],
        required: true,
      },
      {
        key: "thermalCoefficient",
        label: "Coeficiente de Expansão Térmica",
        type: "number",
        unit: "µm/(m·K)",
        required: false,
      },
    ],
  },
  {
    name: "Relógio Comparador",
    slug: "relogio-comparador",
    description: "Relógios comparadores analógicos e digitais",
    definition: [
      {
        key: "capacity",
        label: "Capacidade",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "dialReading",
        label: "Leitura por Volta",
        type: "number",
        unit: "mm",
        required: false,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Analógico", "Digital"],
        required: false,
      },
    ],
  },
  {
    name: "Termômetro Digital",
    slug: "termometro-digital",
    description:
      "Termômetros digitais com sensores PT100, termopar ou termistor",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "°C",
        required: true,
      },
      {
        key: "sensorType",
        label: "Tipo de Sensor",
        type: "select",
        options: ["PT100", "PT1000", "Termopar K", "Termopar J", "Termistor"],
        required: false,
      },
      {
        key: "channelCount",
        label: "Número de Canais",
        type: "number",
        unit: "",
        required: false,
      },
    ],
  },
  {
    name: "Pipeta",
    slug: "pipeta",
    description:
      "Pipetas de volume fixo e variável para medição de volume líquido",
    definition: [
      {
        key: "volumeMin",
        label: "Volume Mín.",
        type: "number",
        unit: "µL",
        required: true,
      },
      {
        key: "volumeMax",
        label: "Volume Máx.",
        type: "number",
        unit: "µL",
        required: true,
      },
      {
        key: "channelCount",
        label: "Número de Canais",
        type: "select",
        options: ["1", "8", "12"],
        required: true,
      },
      {
        key: "volumeType",
        label: "Tipo de Volume",
        type: "select",
        options: ["Fixo", "Variável"],
        required: true,
      },
    ],
  },
  {
    name: "Cronômetro",
    slug: "cronometro",
    description: "Cronômetros digitais para medição de tempo",
    definition: [
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "s",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Capacidade Máxima",
        type: "text",
        required: false,
      },
      {
        key: "memoryCount",
        label: "Número de Memórias",
        type: "number",
        unit: "",
        required: false,
      },
    ],
  },
  {
    name: "Torquímetro",
    slug: "torquimetro",
    description: "Torquímetros para medição de torque",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "N·m",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "N·m",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "N·m",
        required: false,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Estalo", "Relógio", "Digital"],
        required: true,
      },
      {
        key: "driveSize",
        label: "Encaixe",
        type: "select",
        options: ['1/4"', '3/8"', '1/2"', '3/4"', '1"'],
        required: false,
      },
    ],
  },
];

async function seed() {
  console.log("Seeding asset types...");

  for (const type of assetTypes) {
    try {
      await db
        .insert(assetType)
        .values(type)
        .onConflictDoNothing({ target: assetType.slug });
      console.log(`  ✓ ${type.name}`);
    } catch (error) {
      console.error(`  ✗ ${type.name}:`, error);
    }
  }

  console.log("\nDone! Seeded", assetTypes.length, "asset types.");
  process.exit(0);
}

seed().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
