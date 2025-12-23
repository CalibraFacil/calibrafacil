export type MockCertificate = {
  id: string
  certificateNumber: string
  assetId: string
  assetName: string
  assetSerialNumber: string
  clientId: string
  clientName: string
  calibrationDate: string
  expirationDate: string
  technicianName: string
  status: 'valid' | 'expired' | 'pending_approval' | 'revoked'
}

export const mockCertificates: MockCertificate[] = [
  {
    id: 'cert-001',
    certificateNumber: 'CAL-2024-0001',
    assetId: 'ast-001',
    assetName: 'Balança Analítica',
    assetSerialNumber: 'SN-2024-001',
    clientId: 'cli-001',
    clientName: 'Laboratório ABC',
    calibrationDate: '2024-06-15',
    expirationDate: '2025-06-15',
    technicianName: 'Pedro Martins',
    status: 'valid',
  },
  {
    id: 'cert-002',
    certificateNumber: 'CAL-2024-0002',
    assetId: 'ast-002',
    assetName: 'Termômetro Digital',
    assetSerialNumber: 'SN-2024-002',
    clientId: 'cli-002',
    clientName: 'Farmacêutica XYZ',
    calibrationDate: '2024-03-20',
    expirationDate: '2025-03-20',
    technicianName: 'Lucas Ferreira',
    status: 'valid',
  },
  {
    id: 'cert-003',
    certificateNumber: 'CAL-2023-0045',
    assetId: 'ast-004',
    assetName: 'Manômetro',
    assetSerialNumber: 'SN-2024-004',
    clientId: 'cli-003',
    clientName: 'Indústria Metalúrgica Silva',
    calibrationDate: '2023-12-01',
    expirationDate: '2024-12-01',
    technicianName: 'Marcos Souza',
    status: 'expired',
  },
  {
    id: 'cert-004',
    certificateNumber: 'CAL-2024-0003',
    assetId: 'ast-005',
    assetName: 'Multímetro Digital',
    assetSerialNumber: 'SN-2024-005',
    clientId: 'cli-002',
    clientName: 'Farmacêutica XYZ',
    calibrationDate: '2024-08-10',
    expirationDate: '2025-08-10',
    technicianName: 'Pedro Martins',
    status: 'valid',
  },
  {
    id: 'cert-005',
    certificateNumber: 'CAL-2024-0004',
    assetId: 'ast-006',
    assetName: 'Pipeta Volumétrica',
    assetSerialNumber: 'SN-2024-006',
    clientId: 'cli-004',
    clientName: 'Hospital Central',
    calibrationDate: '2024-10-05',
    expirationDate: '2025-10-05',
    technicianName: 'Lucas Ferreira',
    status: 'pending_approval',
  },
]

export function searchCertificates(query: string): MockCertificate[] {
  const lowerQuery = query.toLowerCase()
  return mockCertificates.filter(
    (cert) =>
      cert.certificateNumber.toLowerCase().includes(lowerQuery) ||
      cert.assetName.toLowerCase().includes(lowerQuery) ||
      cert.assetSerialNumber.toLowerCase().includes(lowerQuery) ||
      cert.clientName.toLowerCase().includes(lowerQuery)
  )
}
