export type MockClient = {
  id: string
  name: string
  cnpj: string
  email: string
  phone: string
  address: string
  contactPerson: string
  activeAssets: number
}

export const mockClients: MockClient[] = [
  {
    id: 'cli-001',
    name: 'Laboratório ABC',
    cnpj: '12.345.678/0001-90',
    email: 'contato@lababc.com.br',
    phone: '(11) 3456-7890',
    address: 'Rua das Análises, 100 - São Paulo, SP',
    contactPerson: 'Dr. João Silva',
    activeAssets: 15,
  },
  {
    id: 'cli-002',
    name: 'Farmacêutica XYZ',
    cnpj: '98.765.432/0001-10',
    email: 'qualidade@farmaxyz.com.br',
    phone: '(11) 9876-5432',
    address: 'Av. dos Medicamentos, 500 - Guarulhos, SP',
    contactPerson: 'Dra. Maria Santos',
    activeAssets: 32,
  },
  {
    id: 'cli-003',
    name: 'Indústria Metalúrgica Silva',
    cnpj: '45.678.901/0001-23',
    email: 'engenharia@metalsilva.com.br',
    phone: '(19) 3456-7890',
    address: 'Rod. Industrial, Km 45 - Campinas, SP',
    contactPerson: 'Eng. Carlos Oliveira',
    activeAssets: 8,
  },
  {
    id: 'cli-004',
    name: 'Hospital Central',
    cnpj: '34.567.890/0001-45',
    email: 'engclinica@hospitalcentral.org.br',
    phone: '(11) 2345-6789',
    address: 'Av. da Saúde, 1000 - São Paulo, SP',
    contactPerson: 'Eng. Ana Costa',
    activeAssets: 45,
  },
  {
    id: 'cli-005',
    name: 'Alimentos Naturais Ltda',
    cnpj: '56.789.012/0001-67',
    email: 'qualidade@alimentosnaturais.com.br',
    phone: '(11) 4567-8901',
    address: 'Rua dos Grãos, 200 - Osasco, SP',
    contactPerson: 'Nutricionista Paula Mendes',
    activeAssets: 12,
  },
]

export function searchClients(query: string): MockClient[] {
  const lowerQuery = query.toLowerCase()
  return mockClients.filter(
    (client) =>
      client.name.toLowerCase().includes(lowerQuery) ||
      client.cnpj.includes(query) ||
      client.contactPerson.toLowerCase().includes(lowerQuery)
  )
}
