import type { IconSvgElement } from '@hugeicons/react'
import {
  Clock01Icon,
  FileValidationIcon,
  Invoice03Icon,
  MoneyExchange03Icon,
  PackageIcon,
  ShoppingCart02Icon,
  Tag01Icon,
  UserMultipleIcon,
} from '@hugeicons/core-free-icons'
import type {
  ContaAzulBudgetMode,
  ContaAzulExportMode,
  ContaAzulFiscalMode,
  ContaAzulProtocolMode,
  ContaAzulSaleTrigger,
  ContaAzulSyncDomain,
  IntegrationProviderCapabilities,
} from '@calibra-facil/shared'

/** Conta Azul brand blue — used sparingly for the native-integration accent. */
export const CONTA_AZUL_BRAND = '#2687e9'

export const contaAzulExportModeOptions = [
  { value: 'receivable_event', label: 'Recebível' },
  { value: 'sale', label: 'Venda' },
  { value: 'sale_and_receivable', label: 'Venda + recebível' },
  { value: 'budget_to_sale', label: 'Orçamento para venda' },
  { value: 'contract_generated', label: 'Contrato recorrente' },
] as const satisfies ReadonlyArray<{
  value: ContaAzulExportMode
  label: string
}>

export const contaAzulBudgetModeOptions = [
  { value: 'sales_search_link', label: 'Vínculo por vendas' },
] as const satisfies ReadonlyArray<{
  value: ContaAzulBudgetMode
  label: string
}>

export const contaAzulFiscalModeOptions = [
  { value: 'consultation_only', label: 'Consulta' },
  { value: 'disabled', label: 'Desativado' },
] as const satisfies ReadonlyArray<{
  value: ContaAzulFiscalMode
  label: string
}>

export const contaAzulProtocolModeOptions = [
  { value: 'api_lookup_verified', label: 'Consulta validada' },
  { value: 'metadata_only', label: 'Metadados' },
] as const satisfies ReadonlyArray<{
  value: ContaAzulProtocolMode
  label: string
}>

export const contaAzulSaleTriggerOptions = [
  { value: 'manual', label: 'Manual' },
  { value: 'quote_approved', label: 'Orçamento aprovado' },
  { value: 'service_order_approved', label: 'OS aprovada' },
  { value: 'service_order_completed', label: 'OS concluída' },
  { value: 'certificate_approved', label: 'Certificado aprovado' },
  { value: 'billing_document_issued', label: 'Documento emitido' },
] as const satisfies ReadonlyArray<{
  value: ContaAzulSaleTrigger
  label: string
}>

export type ContaAzulDomainGroup = {
  title: string
  icon: IconSvgElement
  domains: ReadonlyArray<{
    key: ContaAzulSyncDomain
    label: string
    description: string
  }>
}

export const contaAzulDomainGroups = [
  {
    title: 'Pessoas',
    icon: UserMultipleIcon,
    domains: [
      {
        key: 'customers',
        label: 'Clientes',
        description: 'Pessoas usadas pelos fluxos do laboratório.',
      },
      {
        key: 'suppliers',
        label: 'Fornecedores',
        description: 'Terceiros, insumos, manutenção e subcontratação.',
      },
      {
        key: 'transporters',
        label: 'Transportadoras',
        description: 'Referências de logística e coleta/entrega.',
      },
    ],
  },
  {
    title: 'Catálogo',
    icon: PackageIcon,
    domains: [
      {
        key: 'services',
        label: 'Serviços',
        description: 'Serviços comerciais e calibrações vendidas.',
      },
      {
        key: 'products',
        label: 'Produtos',
        description: 'Peças, acessórios, padrões e itens físicos.',
      },
      {
        key: 'inventoryTaxonomy',
        label: 'Fiscal/estoque',
        description: 'NCM, CEST, unidades, categorias e estoque.',
      },
    ],
  },
  {
    title: 'Comercial',
    icon: ShoppingCart02Icon,
    domains: [
      {
        key: 'budgets',
        label: 'Orçamentos',
        description: 'Propostas antes da conversão em venda.',
      },
      {
        key: 'sales',
        label: 'Vendas',
        description: 'Exportação de vendas e itens comerciais.',
      },
      {
        key: 'sellers',
        label: 'Vendedores',
        description: 'Responsáveis comerciais e donos da conta.',
      },
      {
        key: 'contracts',
        label: 'Contratos',
        description: 'Recorrência para receita e vendas geradas.',
      },
    ],
  },
  {
    title: 'Financeiro',
    icon: MoneyExchange03Icon,
    domains: [
      {
        key: 'billingDocuments',
        label: 'Faturamento',
        description: 'Documentos financeiros do CalibraFácil.',
      },
      {
        key: 'receivables',
        label: 'Recebíveis',
        description: 'Contas a receber e parcelas.',
      },
      {
        key: 'payables',
        label: 'Contas a pagar',
        description: 'Despesas, obrigações e parcelas de fornecedores.',
      },
      {
        key: 'expenses',
        label: 'Despesas',
        description: 'Custos de OS, frete, manutenção e insumos.',
      },
      {
        key: 'financialAccounts',
        label: 'Contas financeiras',
        description: 'Contas, referência bancária e caixa.',
      },
      {
        key: 'balances',
        label: 'Saldos',
        description: 'Saldo atual por conta financeira.',
      },
      {
        key: 'transfers',
        label: 'Transferências',
        description: 'Movimentos entre contas financeiras.',
      },
      {
        key: 'baixas',
        label: 'Baixas',
        description: 'Liquidação, juros, desconto e valor pago.',
      },
      {
        key: 'paymentStatusPolling',
        label: 'Polling financeiro',
        description: 'Reconciliação agendada sem webhooks.',
      },
    ],
  },
  {
    title: 'Classificação',
    icon: Tag01Icon,
    domains: [
      {
        key: 'categories',
        label: 'Categorias',
        description: 'Categoria financeira padrão e por fluxo.',
      },
      {
        key: 'dreCategories',
        label: 'Categorias DRE',
        description: 'Classificação gerencial e rateio.',
      },
      {
        key: 'costCenters',
        label: 'Centros de custo',
        description: 'Unidade, laboratório, grandeza e rateio.',
      },
    ],
  },
  {
    title: 'Fiscal e documentos',
    icon: Invoice03Icon,
    domains: [
      {
        key: 'fiscalDocuments',
        label: 'Notas fiscais',
        description: 'NF-e, NFS-e, status, chave e vínculos.',
      },
      {
        key: 'remoteDocuments',
        label: 'PDFs/XML',
        description: 'PDF de venda e documentos remotos disponíveis.',
      },
      {
        key: 'protocols',
        label: 'Protocolos',
        description: 'Área própria da API a mapear por OpenAPI.',
      },
      {
        key: 'driftChecks',
        label: 'Drift remoto',
        description: 'Cancelamento, exclusão e inativação remotos.',
      },
    ],
  },
] as const satisfies ReadonlyArray<ContaAzulDomainGroup>

type ContaAzulCapabilityChip = {
  icon: IconSvgElement
  label: string
  value: string
}

export function getContaAzulCapabilityChips(
  capabilities: IntegrationProviderCapabilities,
): ReadonlyArray<ContaAzulCapabilityChip> {
  return [
    {
      icon: MoneyExchange03Icon,
      label: 'Recebíveis',
      value:
        capabilities.canCreateReceivables &&
        capabilities.canReadReceivableStatus
          ? 'Enviar e acompanhar'
          : 'Indisponível',
    },
    {
      icon: Invoice03Icon,
      label: 'Documentos fiscais',
      value: capabilities.canIssueFiscalDocuments
        ? 'Emissão e consulta'
        : capabilities.canReadFiscalDocuments
          ? 'Consulta'
          : 'Indisponível',
    },
    {
      icon: Clock01Icon,
      label: 'Atualização',
      value:
        capabilities.requiresPolling && !capabilities.canUseWebhooks
          ? 'Polling, sem webhooks'
          : 'Tempo real',
    },
    {
      icon: Tag01Icon,
      label: 'Categorias',
      value: capabilities.supportsCategories ? 'Suportado' : 'Indisponível',
    },
    {
      icon: MoneyExchange03Icon,
      label: 'Centros de custo',
      value: capabilities.supportsCostCenters ? 'Suportado' : 'Indisponível',
    },
  ] as const
}

export const contaAzulCapabilities = [
  { icon: UserMultipleIcon, label: 'Pessoas', value: 'Clientes e terceiros' },
  {
    icon: ShoppingCart02Icon,
    label: 'Comercial',
    value: 'Orçamentos e vendas',
  },
  { icon: MoneyExchange03Icon, label: 'Financeiro', value: 'Receber e pagar' },
  { icon: Invoice03Icon, label: 'Fiscal', value: 'NF-e e NFS-e' },
  { icon: PackageIcon, label: 'Catálogo', value: 'Produtos e serviços' },
  { icon: FileValidationIcon, label: 'Documentos', value: 'PDFs e XML' },
] as const satisfies ReadonlyArray<{
  icon: IconSvgElement
  label: string
  value: string
}>

export const contaAzulScheduleRows = [
  {
    key: 'paymentStatusPolling',
    label: 'Status do pagamento',
    description: 'Recebíveis e parcelas em aberto.',
  },
  {
    key: 'payables',
    label: 'Contas a pagar',
    description: 'Obrigações e parcelas de fornecedores.',
  },
  {
    key: 'fiscalDocuments',
    label: 'Documentos fiscais',
    description: 'Notas e documentos remotos vinculados.',
  },
  {
    key: 'protocols',
    label: 'Protocolos fiscais',
    description: 'Andamento de protocolos consultáveis.',
  },
  {
    key: 'driftChecks',
    label: 'Verificação de divergências',
    description: 'Mudanças remotas em registros vinculados.',
  },
] as const

const contaAzulOptionLabels = new Map<string, string>(
  [
    ...contaAzulExportModeOptions,
    ...contaAzulBudgetModeOptions,
    ...contaAzulFiscalModeOptions,
    ...contaAzulProtocolModeOptions,
    ...contaAzulSaleTriggerOptions,
  ].map((option) => [option.value, option.label]),
)

export function formatContaAzulOption(value: string) {
  return contaAzulOptionLabels.get(value) ?? value
}
