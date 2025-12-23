export type MockAsset = {
  id: string
  serialNumber: string
  name: string
  type: string
  manufacturer: string
  model: string
  clientId: string
  clientName: string
  status: 'active' | 'calibrating' | 'out_of_service' | 'pending'
  lastCalibrationDate: string | null
  nextCalibrationDate: string | null
}

export const mockAssets: Array<MockAsset> = [
  {
    id: 'ast-001',
    serialNumber: 'SN-2024-001',
    name: 'Balança Analítica',
    type: 'Balança',
    manufacturer: 'Mettler Toledo',
    model: 'XPE205',
    clientId: 'cli-001',
    clientName: 'Laboratório ABC',
    status: 'active',
    lastCalibrationDate: '2024-06-15',
    nextCalibrationDate: '2025-06-15',
  },
  {
    id: 'ast-002',
    serialNumber: 'SN-2024-002',
    name: 'Termômetro Digital',
    type: 'Termômetro',
    manufacturer: 'Fluke',
    model: '1523',
    clientId: 'cli-002',
    clientName: 'Farmacêutica XYZ',
    status: 'calibrating',
    lastCalibrationDate: '2024-03-20',
    nextCalibrationDate: '2025-03-20',
  },
  {
    id: 'ast-003',
    serialNumber: 'SN-2024-003',
    name: 'Paquímetro',
    type: 'Dimensional',
    manufacturer: 'Mitutoyo',
    model: '500-196-30',
    clientId: 'cli-001',
    clientName: 'Laboratório ABC',
    status: 'pending',
    lastCalibrationDate: null,
    nextCalibrationDate: null,
  },
  {
    id: 'ast-004',
    serialNumber: 'SN-2024-004',
    name: 'Manômetro',
    type: 'Pressão',
    manufacturer: 'Ashcroft',
    model: '1279',
    clientId: 'cli-003',
    clientName: 'Indústria Metalúrgica Silva',
    status: 'out_of_service',
    lastCalibrationDate: '2023-12-01',
    nextCalibrationDate: '2024-12-01',
  },
  {
    id: 'ast-005',
    serialNumber: 'SN-2024-005',
    name: 'Multímetro Digital',
    type: 'Elétrico',
    manufacturer: 'Keysight',
    model: '34461A',
    clientId: 'cli-002',
    clientName: 'Farmacêutica XYZ',
    status: 'active',
    lastCalibrationDate: '2024-08-10',
    nextCalibrationDate: '2025-08-10',
  },
]

export function searchAssets(query: string): Array<MockAsset> {
  const lowerQuery = query.toLowerCase()
  return mockAssets.filter(
    (asset) =>
      asset.serialNumber.toLowerCase().includes(lowerQuery) ||
      asset.name.toLowerCase().includes(lowerQuery) ||
      asset.id.toLowerCase().includes(lowerQuery) ||
      asset.clientName.toLowerCase().includes(lowerQuery),
  )
}
