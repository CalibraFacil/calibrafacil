/**
 * Seed script for ISO 17025 / RBC / Inmetro equipment types.
 * Run this after migration to populate the asset_type table with common calibration instruments.
 *
 * Usage: bun run src/seed-asset-types.ts
 */

import { db } from "./db";
import { assetType, type AssetTypeFieldDefinition } from "./schema";
import { seedLegalMetrologyRegulations } from "./seed-legal-metrology-regulations";

export type AssetTypeSeed = {
  name: string;
  slug: string;
  description: string;
  definition: AssetTypeFieldDefinition[];
};

export const ASSET_TYPE_SEED: AssetTypeSeed[] = [
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
  {
    name: "Dinamômetro",
    slug: "dinamometro",
    description:
      "Dinamômetros e células de carga para medição de força (tração/compressão)",
    definition: [
      {
        key: "capacity",
        label: "Capacidade Máxima",
        type: "number",
        unit: "N",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "N",
        required: true,
      },
      {
        key: "forceUnit",
        label: "Unidade de Força",
        type: "select",
        options: ["N", "kN", "kgf"],
        required: false,
      },
      {
        key: "loadMode",
        label: "Modo de Carga",
        type: "select",
        options: ["Tração", "Compressão", "Tração/Compressão"],
        required: true,
      },
      {
        key: "accuracyClass",
        label: "Classe de Exatidão",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Multímetro Digital",
    slug: "multimetro-digital",
    description:
      "Multímetros digitais para medição de tensão, corrente e resistência (DC)",
    definition: [
      {
        key: "displayDigits",
        label: "Dígitos",
        type: "select",
        options: ["3½", "4½", "5½", "6½", "7½"],
        required: true,
      },
      {
        key: "voltageRangeMax",
        label: "Faixa de Tensão Máx.",
        type: "number",
        unit: "V",
        required: false,
      },
      {
        key: "currentRangeMax",
        label: "Faixa de Corrente Máx.",
        type: "number",
        unit: "A",
        required: false,
      },
      {
        key: "resistanceRangeMax",
        label: "Faixa de Resistência Máx.",
        type: "number",
        unit: "MΩ",
        required: false,
      },
      {
        key: "accuracyClass",
        label: "Exatidão (% leitura + dígitos)",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Tacômetro",
    slug: "tacometro",
    description:
      "Tacômetros de contato e ópticos para medição de rotação/frequência",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "rpm",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "rpm",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "rpm",
        required: true,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Contato", "Óptico", "Contato/Óptico"],
        required: true,
      },
    ],
  },
  {
    name: "Hidrômetro",
    slug: "hidrometro",
    description:
      "Hidrômetros para medição de volume de água (metrologia legal — verificação periódica)",
    definition: [
      {
        // Taxonomy per NBR 8194 / mercado: velocimétricos (unijato, multijato,
        // Woltmann), volumétricos e estáticos (ultrassônico, eletromagnético).
        key: "measurementPrinciple",
        label: "Princípio de Medição",
        type: "select",
        options: [
          "Velocimétrico unijato",
          "Velocimétrico multijato",
          "Woltmann",
          "Volumétrico",
          "Ultrassônico (estático)",
          "Eletromagnético (estático)",
        ],
        required: true,
      },
      {
        key: "indicatorType",
        label: "Tipo de Indicação",
        type: "select",
        options: ["Analógico (relojoaria)", "Digital (eletrônico)"],
        required: true,
      },
      {
        key: "nominalDiameter",
        label: "Diâmetro Nominal (DN)",
        type: "number",
        unit: "mm",
        required: false,
      },
      {
        // Rosca BSP conforme NBR 8194 / NBR NM-ISO 7-1 (DN15 → 3/4", DN20 → 1");
        // acima de DN40 a conexão é usualmente flangeada.
        key: "connectionThread",
        label: "Rosca de Conexão",
        type: "select",
        options: ['1/2"', '3/4"', '1"', '1 1/4"', '1 1/2"', '2"', "Flangeado"],
        required: false,
      },
      {
        key: "permanentFlowRate",
        label: "Vazão Permanente (Q3)",
        type: "number",
        unit: "m³/h",
        required: true,
      },
      {
        key: "metrologicalClass",
        label: "Classe Metrológica (razão R)",
        type: "text",
        required: false,
      },
      {
        key: "totalizerCapacity",
        label: "Capacidade do Totalizador",
        type: "number",
        unit: "m³",
        required: false,
      },
      {
        key: "resolution",
        label: "Menor Divisão do Totalizador",
        type: "number",
        unit: "L",
        required: true,
      },
      {
        key: "inmetroRegistration",
        label: "Registro/Aprovação Inmetro",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Esfigmomanômetro",
    slug: "esfigmomanometro",
    description:
      "Esfigmomanômetros mecânicos e digitais para medição de pressão arterial",
    definition: [
      {
        key: "rangeMin",
        label: "Faixa Mín.",
        type: "number",
        unit: "mmHg",
        required: true,
      },
      {
        key: "rangeMax",
        label: "Faixa Máx.",
        type: "number",
        unit: "mmHg",
        required: true,
      },
      {
        key: "scaleDivision",
        label: "Divisão de Escala",
        type: "number",
        unit: "mmHg",
        required: true,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Aneroide", "Digital", "Coluna de mercúrio"],
        required: true,
      },
      {
        key: "inmetroRegistration",
        label: "Registro/Aprovação Inmetro",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Medidor de Gás",
    slug: "medidor-gas",
    description:
      "Medidores de gás para medição de volume (diafragma, ultrassônico, turbina, rotativo)",
    definition: [
      {
        // Values match the technology keys of the "Medidores de gás"
        // legal-metrology catalog entry (byTechnology), so the asset spec and
        // the regulated-interval technology stay consistent.
        key: "technology",
        label: "Tecnologia de Medição",
        type: "select",
        options: ["diafragma", "ultrassonico", "turbina", "rotativo"],
        required: true,
      },
      {
        key: "cyclicVolume",
        label: "Volume Cíclico",
        type: "number",
        unit: "L",
        required: false,
      },
      {
        key: "minFlowRate",
        label: "Vazão Mín. (Qmin)",
        type: "number",
        unit: "m³/h",
        required: false,
      },
      {
        key: "maxFlowRate",
        label: "Vazão Máx. (Qmax)",
        type: "number",
        unit: "m³/h",
        required: true,
      },
      {
        key: "totalizerCapacity",
        label: "Capacidade do Totalizador",
        type: "number",
        unit: "m³",
        required: false,
      },
      {
        key: "inmetroRegistration",
        label: "Registro/Aprovação Inmetro",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Peso Padrão",
    slug: "peso-padrao",
    description:
      "Pesos padrão e massas de referência para calibração de instrumentos de pesagem",
    definition: [
      {
        key: "nominalValue",
        label: "Valor Nominal",
        type: "number",
        unit: "g",
        required: true,
      },
      {
        key: "oimlClass",
        label: "Classe de Exatidão (OIML R 111)",
        type: "select",
        options: ["E1", "E2", "F1", "F2", "M1", "M1-2", "M2", "M2-3", "M3"],
        required: true,
      },
      {
        key: "material",
        label: "Material",
        type: "select",
        options: ["Aço inoxidável", "Latão", "Ferro fundido", "Outro"],
        required: false,
      },
      {
        key: "shape",
        label: "Forma",
        type: "select",
        options: ["Cilíndrico", "Paralelepípedo", "Disco", "Outro"],
        required: false,
      },
    ],
  },
  {
    name: "Termômetro Infravermelho",
    slug: "termometro-infravermelho",
    description:
      "Termômetros de radiação infravermelha (pirômetros) para medição de temperatura sem contato",
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
        key: "emissivity",
        label: "Emissividade (ajuste)",
        type: "text",
        required: false,
      },
      {
        key: "distanceToSpotRatio",
        label: "Relação Distância:Alvo (D:S)",
        type: "text",
        required: false,
      },
    ],
  },
  {
    name: "Estufa / Banho Térmico",
    slug: "estufa-banho-termico",
    description:
      "Estufas, muflas, banhos termostáticos e incubadoras (caracterização térmica de câmara)",
    definition: [
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: [
          "Estufa",
          "Mufla",
          "Banho termostático",
          "Incubadora",
          "Freezer/Refrigerador",
        ],
        required: true,
      },
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
        label: "Resolução do Indicador",
        type: "number",
        unit: "°C",
        required: false,
      },
      {
        key: "chamberVolume",
        label: "Volume da Câmara",
        type: "number",
        unit: "L",
        required: false,
      },
    ],
  },
  {
    name: "Câmara Climática",
    slug: "camara-climatica",
    description:
      "Câmaras climáticas e de estabilidade para temperatura e umidade relativa",
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
    name: "Vidraria Volumétrica",
    slug: "vidraria-volumetrica",
    description:
      "Balões volumétricos, buretas, provetas e pipetas de vidro (calibração gravimétrica de volume)",
    definition: [
      {
        key: "nominalVolume",
        label: "Volume Nominal",
        type: "number",
        unit: "mL",
        required: true,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: [
          "Balão volumétrico",
          "Bureta",
          "Proveta",
          "Pipeta volumétrica",
          "Pipeta graduada",
          "Dispensador",
        ],
        required: true,
      },
      {
        key: "accuracyClass",
        label: "Classe",
        type: "select",
        options: ["A", "B"],
        required: false,
      },
      {
        key: "calibrationMode",
        label: "Modo de Calibração",
        type: "select",
        options: ["Para conter (TC/In)", "Para dispensar (TD/Ex)"],
        required: false,
      },
      {
        key: "scaleDivision",
        label: "Menor Divisão",
        type: "number",
        unit: "mL",
        required: false,
      },
    ],
  },
  {
    name: "Trena / Escala Métrica",
    slug: "trena-escala",
    description:
      "Trenas, escalas e réguas metálicas para medição dimensional linear",
    definition: [
      {
        key: "capacity",
        label: "Capacidade",
        type: "number",
        unit: "m",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução (menor divisão)",
        type: "number",
        unit: "mm",
        required: true,
      },
      {
        key: "instrumentType",
        label: "Tipo",
        type: "select",
        options: ["Trena", "Escala/Régua", "Fita métrica"],
        required: true,
      },
      {
        key: "accuracyClass",
        label: "Classe de Exatidão",
        type: "select",
        options: ["I", "II", "III"],
        required: false,
      },
    ],
  },
  {
    name: "Analisador de Umidade",
    slug: "analisador-umidade",
    description:
      "Analisadores de umidade por termogravimetria (balança de secagem por aquecimento)",
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
        label: "Resolução de Massa (d)",
        type: "number",
        unit: "g",
        required: true,
      },
      {
        key: "moistureResolution",
        label: "Resolução de Umidade",
        type: "number",
        unit: "%",
        required: false,
      },
      {
        key: "dryingTempMax",
        label: "Temperatura Máx. de Secagem",
        type: "number",
        unit: "°C",
        required: false,
      },
      {
        key: "heatingTechnology",
        label: "Tecnologia de Aquecimento",
        type: "select",
        options: ["Halógeno", "Infravermelho", "Micro-ondas"],
        required: false,
      },
    ],
  },
  {
    name: "Prensa Hidráulica",
    slug: "prensa-hidraulica",
    description:
      "Prensas hidráulicas e máquinas de ensaio para medição de força de compressão",
    definition: [
      {
        key: "capacity",
        label: "Capacidade Máxima",
        type: "number",
        unit: "kN",
        required: true,
      },
      {
        key: "resolution",
        label: "Resolução",
        type: "number",
        unit: "kN",
        required: true,
      },
      {
        key: "loadMode",
        label: "Modo de Carga",
        type: "select",
        options: ["Compressão", "Tração", "Tração/Compressão"],
        required: true,
      },
      {
        key: "accuracyClass",
        label: "Classe de Exatidão",
        type: "text",
        required: false,
      },
    ],
  },
];

async function seed() {
  console.log("Seeding asset types...");

  for (const type of ASSET_TYPE_SEED) {
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

  // Also seed the GLOBAL legal-metrology regulation catalog (deferred #3 of #423).
  // Idempotent + data-only (ON CONFLICT DO NOTHING on `category`; touches no asset row).
  console.log("Seeding legal-metrology regulations...");
  await seedLegalMetrologyRegulations(db);
  console.log("  ✓ legal-metrology regulation catalog");

  console.log("\nDone! Seeded", ASSET_TYPE_SEED.length, "asset types.");
  process.exit(0);
}

// Only run when executed directly (`bun run src/seed-asset-types.ts`), so the
// seed array stays importable by tests without touching a database.
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-asset-types");

if (invokedDirectly) {
  seed().catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
}
