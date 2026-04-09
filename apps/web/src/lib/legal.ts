export const LEGAL_LAST_UPDATED = '09/04/2026'
export const LEGAL_VERSION = '1.0'
export const LEGAL_TECHNICAL_RETENTION_YEARS = 5

export const LEGAL_ENTITY = {
  legalName: 'OPERADOR EXEMPLO',
  representativeName: 'Operador Exemplo',
  cnpj: '00.000.000/0000-00',
  addressLine: 'Rua Exemplo, 100',
  district: 'Centro',
  city: 'Porto Alegre',
  state: 'RS',
  postalCode: '90000-000',
  email: 'contato@calibrafacil.com',
  forum: 'Porto Alegre/RS',
  dpoName: 'Operador Exemplo',
  dpoEmail: 'contato@calibrafacil.com',
  get cityState() {
    return `${this.city}/${this.state}`
  },
  get fullAddress() {
    return `${this.addressLine}, bairro ${this.district}, ${this.city}/${this.state}, CEP ${this.postalCode}`
  },
} as const

export const LEGAL_SUBPROCESSORS = [
  {
    name: 'Cloudflare',
    role: 'Hospedagem (Workers, Pages) e armazenamento (R2)',
    sharedData: 'Dados de acesso, documentos armazenados e arquivos exportados',
  },
  {
    name: 'Neon',
    role: 'Banco de dados PostgreSQL',
    sharedData: 'Dados persistidos na plataforma',
  },
  {
    name: 'Asaas',
    role: 'Processamento de pagamentos e faturamento',
    sharedData:
      'Dados de cobrança e informações fiscais necessárias ao pagamento',
  },
  {
    name: 'Resend',
    role: 'Envio de e-mails transacionais',
    sharedData: 'Nome e endereço de e-mail dos destinatários',
  },
] as const
