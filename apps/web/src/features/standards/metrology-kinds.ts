import type { ReferenceStandardKind } from '@calibra-facil/schemas'

export type MetrologyKindDefinition = {
  kind: ReferenceStandardKind
  label: string
  typeLabel: string
  mode: 'scalar' | 'mass' | 'channels'
  description: string
  channels: Array<{
    key: string
    label: string
    quantity: string
    unit: string
  }>
}

export const METROLOGY_KIND_DEFINITIONS: MetrologyKindDefinition[] = [
  {
    kind: 'mass_single',
    label: 'Peso individual',
    typeLabel: 'Peso',
    mode: 'mass',
    description: 'Um peso ou massa padrão com um valor certificado.',
    channels: [],
  },
  {
    kind: 'mass_set',
    label: 'Conjunto de pesos',
    typeLabel: 'Conjunto de pesos',
    mode: 'mass',
    description: 'Jogo de pesos com múltiplos valores e perfis de composição.',
    channels: [],
  },
  {
    kind: 'thermohygrometer',
    label: 'Temperatura e Umidade',
    typeLabel: 'Termohigrômetro',
    mode: 'channels',
    description: 'Padrão ambiental com canais de temperatura e umidade.',
    channels: [
      {
        key: 'temperature',
        label: 'Temperatura',
        quantity: 'temperature',
        unit: '°C',
      },
      {
        key: 'humidity',
        label: 'Umidade',
        quantity: 'humidity',
        unit: '%RH',
      },
    ],
  },
  {
    kind: 'thermometer',
    label: 'Temperatura',
    typeLabel: 'Termômetro',
    mode: 'channels',
    description: 'Padrão com canal de temperatura.',
    channels: [
      {
        key: 'temperature',
        label: 'Temperatura',
        quantity: 'temperature',
        unit: '°C',
      },
    ],
  },
  {
    kind: 'hygrometer',
    label: 'Umidade',
    typeLabel: 'Higrômetro',
    mode: 'channels',
    description: 'Padrão com canal de umidade relativa.',
    channels: [
      {
        key: 'humidity',
        label: 'Umidade',
        quantity: 'humidity',
        unit: '%RH',
      },
    ],
  },
  {
    kind: 'barometer',
    label: 'Pressão',
    typeLabel: 'Barômetro',
    mode: 'channels',
    description: 'Padrão com canal de pressão atmosférica.',
    channels: [
      {
        key: 'pressure',
        label: 'Pressão',
        quantity: 'pressure',
        unit: 'hPa',
      },
    ],
  },
  {
    kind: 'manometer',
    label: 'Pressão manométrica',
    typeLabel: 'Manômetro',
    mode: 'channels',
    description: 'Padrão com canal de pressão manométrica.',
    channels: [
      {
        key: 'pressure',
        label: 'Pressão',
        quantity: 'pressure',
        unit: 'bar',
      },
    ],
  },
  {
    kind: 'dimensional',
    label: 'Dimensional',
    typeLabel: 'Dimensional',
    mode: 'channels',
    description:
      'Blocos, paquímetros, micrômetros e outros padrões dimensionais.',
    channels: [
      {
        key: 'length',
        label: 'Comprimento',
        quantity: 'length',
        unit: 'mm',
      },
    ],
  },
  {
    kind: 'electrical',
    label: 'Elétrico',
    typeLabel: 'Elétrico',
    mode: 'channels',
    description: 'Grandezas elétricas como tensão, corrente e resistência.',
    channels: [
      {
        key: 'electrical',
        label: 'Grandeza elétrica',
        quantity: 'electrical',
        unit: 'V',
      },
    ],
  },
  {
    kind: 'time_frequency',
    label: 'Tempo/Frequência',
    typeLabel: 'Tempo e frequência',
    mode: 'channels',
    description: 'Cronômetros, temporizadores e frequência.',
    channels: [
      {
        key: 'time',
        label: 'Tempo',
        quantity: 'time',
        unit: 's',
      },
    ],
  },
  {
    kind: 'volume',
    label: 'Volume',
    typeLabel: 'Volume',
    mode: 'channels',
    description: 'Padrões volumétricos e vidrarias.',
    channels: [
      {
        key: 'volume',
        label: 'Volume',
        quantity: 'volume',
        unit: 'mL',
      },
    ],
  },
  {
    kind: 'force_torque',
    label: 'Força/Torque',
    typeLabel: 'Força e torque',
    mode: 'channels',
    description: 'Células de carga, dinamômetros e torquímetros.',
    channels: [
      {
        key: 'force',
        label: 'Força',
        quantity: 'force',
        unit: 'N',
      },
    ],
  },
  {
    kind: 'rpm',
    label: 'Rotação',
    typeLabel: 'Rotação',
    mode: 'channels',
    description: 'Tacômetros e padrões de rotação.',
    channels: [
      {
        key: 'rotation',
        label: 'Rotação',
        quantity: 'rotation',
        unit: 'rpm',
      },
    ],
  },
  {
    kind: 'generic_scalar',
    label: 'Genérico: valor único',
    typeLabel: 'Padrão genérico',
    mode: 'scalar',
    description: 'Padrão com um único valor de referência.',
    channels: [],
  },
  {
    kind: 'generic_multi_channel',
    label: 'Genérico: múltiplos canais',
    typeLabel: 'Padrão multicanal',
    mode: 'channels',
    description: 'Padrão com canais configurados manualmente.',
    channels: [
      {
        key: 'channel_1',
        label: 'Canal 1',
        quantity: 'generic',
        unit: '',
      },
    ],
  },
]

export const METROLOGY_KIND_BY_KIND = new Map(
  METROLOGY_KIND_DEFINITIONS.map((definition) => [definition.kind, definition]),
)

export function metrologyKindDefinition(kind: ReferenceStandardKind) {
  return (
    METROLOGY_KIND_BY_KIND.get(kind) ??
    METROLOGY_KIND_BY_KIND.get('generic_scalar')!
  )
}
