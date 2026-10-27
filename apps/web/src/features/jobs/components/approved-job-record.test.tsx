// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ApprovedJobRecordData } from '@/features/jobs/detail-model'

const navigate = vi.fn()

const queryMocks = vi.hoisted(() => ({
  getJobCertificateDownloadUrl: vi.fn(),
  getJobLabelDownloadUrl: vi.fn(),
  useJobCertificateDownloadUrlData: vi.fn(),
}))

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({
  amend: vi.fn(),
  generateLabel: vi.fn(),
  withdrawCertificate: vi.fn(),
}))

vi.mock('@/components/method-runtime/math-runtime', () => ({
  normalizeMethodValidations: (validations: unknown) =>
    Array.isArray(validations) ? validations : [],
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({
    children,
    className,
  }: {
    children?: ReactNode
    className?: string
  }) => <a className={className}>{children}</a>,
}))

vi.mock('@/features/jobs/queries', () => queryMocks)

vi.mock('@/utils/api', () => ({
  calibraApi: {
    jobs: {
      amend: apiMocks.amend,
      generateLabel: apiMocks.generateLabel,
      withdrawCertificate: apiMocks.withdrawCertificate,
    },
  },
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

import { ApprovedJobRecord } from './approved-job-record'

describe('ApprovedJobRecord certificate distribution', () => {
  const originalOpen = window.open

  beforeEach(() => {
    vi.clearAllMocks()
    window.open = vi.fn()
    queryMocks.useJobCertificateDownloadUrlData.mockReturnValue({
      data: 'https://signed-preview.example.test/certificates/7.pdf',
    })
    queryMocks.getJobCertificateDownloadUrl.mockResolvedValue(
      'https://signed-download.example.test/certificates/7.pdf',
    )
  })

  afterEach(() => {
    cleanup()
    window.open = originalOpen
  })

  it('opens a fresh signed certificate download URL from the approved record action', async () => {
    renderApprovedJobRecord()

    fireEvent.click(screen.getByRole('button', { name: /baixar certificado/i }))

    await waitFor(() => {
      expect(queryMocks.getJobCertificateDownloadUrl).toHaveBeenCalledWith(7)
    })
    expect(window.open).toHaveBeenCalledWith(
      'https://signed-download.example.test/certificates/7.pdf',
      '_blank',
    )
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('keeps certificate download disabled until the approved job has a certificate URL', () => {
    renderApprovedJobRecord({ certificateUrl: null })

    const downloadButton = screen.getByRole('button', {
      name: /baixar certificado/i,
    })
    expect(downloadButton).toBeInstanceOf(HTMLButtonElement)
    expect(downloadButton).toHaveProperty('disabled', true)
    expect(queryMocks.useJobCertificateDownloadUrlData).toHaveBeenCalledWith({
      certificateUrl: null,
      enabled: false,
      jobId: 7,
    })
  })

  it('reports certificate download failures without opening a blank tab', async () => {
    queryMocks.getJobCertificateDownloadUrl.mockRejectedValue(
      new Error('URL expirada'),
    )
    renderApprovedJobRecord()

    fireEvent.click(screen.getByRole('button', { name: /baixar certificado/i }))

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith('URL expirada')
    })
    expect(window.open).not.toHaveBeenCalled()
  })
})

describe('ApprovedJobRecord certificate lifecycle (7.8.8 amendments, 7.10 withdrawal)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryMocks.useJobCertificateDownloadUrlData.mockReturnValue({ data: null })
  })

  afterEach(() => {
    cleanup()
  })

  it('says an original with an amendment in progress is still valid, links the amendment and offers no second amendment', () => {
    renderApprovedJobRecord({
      amendmentInProgress: { id: 8, jobId: 'CAL-0007-R1', status: 'DRAFT' },
      certificateLifecycle: {
        status: 'ISSUED',
        changedAt: '2026-05-20T10:00:00.000Z',
        reason: null,
      },
    })

    expect(screen.getByText('Retificação em andamento')).toBeTruthy()
    expect(screen.getByText('CAL-0007-R1')).toBeTruthy()
    expect(screen.getByText(/permanece válido/)).toBeTruthy()
    expect(screen.queryByText('Retificado')).toBeNull()
    expect(
      screen.queryByRole('button', { name: /retificar certificado/i }),
    ).toBeNull()
  })

  it('offers amendment and withdrawal on an issued certificate with no amendment open', () => {
    renderApprovedJobRecord()

    expect(
      screen.getByRole('button', { name: /retificar certificado/i }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /retirar certificado/i }),
    ).toBeTruthy()
  })

  it('shows a withdrawn certificate as retirado, with the date and reason, and offers neither action', () => {
    renderApprovedJobRecord({
      certificateLifecycle: {
        status: 'WITHDRAWN',
        changedAt: '2026-06-01T12:00:00.000Z',
        reason: 'Padrão de referência recolhido',
      },
    })

    expect(screen.getByText('Certificado Retirado')).toBeTruthy()
    expect(screen.getByText('Padrão de referência recolhido')).toBeTruthy()
    expect(screen.getByText('Retirado')).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: /retirar certificado/i }),
    ).toBeNull()
    expect(
      screen.queryByRole('button', { name: /retificar certificado/i }),
    ).toBeNull()
  })

  it('confirms the withdrawal in a dialog that needs a written reason, then calls the API and refreshes the record', async () => {
    apiMocks.withdrawCertificate.mockResolvedValue({})
    const onRefresh = vi.fn()
    renderApprovedJobRecord({}, onRefresh)

    fireEvent.click(
      screen.getByRole('button', { name: /retirar certificado/i }),
    )
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', {
      name: /retirar certificado/i,
    })
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.change(within(dialog).getByLabelText(/motivo da retirada/i), {
      target: { value: '  Padrão de referência recolhido  ' },
    })
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(apiMocks.withdrawCertificate).toHaveBeenCalledWith(
        7,
        'Padrão de referência recolhido',
      )
    })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(toastMocks.success).toHaveBeenCalledWith('Certificado retirado')
  })

  it('keeps the dialog open and reports the failure when the API refuses', async () => {
    apiMocks.withdrawCertificate.mockRejectedValue(
      new Error('Este certificado ja foi retirado'),
    )
    const onRefresh = vi.fn()
    renderApprovedJobRecord({}, onRefresh)

    fireEvent.click(
      screen.getByRole('button', { name: /retirar certificado/i }),
    )
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/motivo da retirada/i), {
      target: { value: 'Padrão de referência recolhido' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: /retirar certificado/i }),
    )

    await waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith(
        'Este certificado ja foi retirado',
      )
    })
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeTruthy()
  })
})

function renderApprovedJobRecord(
  overrides: Partial<ApprovedJobRecordData> = {},
  onRefresh: () => void = vi.fn(),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ApprovedJobRecord
        job={approvedJob(overrides)}
        onBack={vi.fn()}
        onRefresh={onRefresh}
      />
    </QueryClientProvider>,
  )
}

function approvedJob(
  overrides: Partial<ApprovedJobRecordData> = {},
): ApprovedJobRecordData {
  return {
    id: 7,
    jobId: 'CAL-0007',
    status: 'APPROVED',
    customerName: 'Cliente Exemplo',
    assetName: 'Balanca analitica',
    assetTag: 'BAL-01',
    serviceName: 'Calibracao de massa',
    methodSnapshot: {
      methodId: 3,
      methodName: 'Metodo de massa',
      methodVersion: 2,
      dataFields: [],
      formulas: [],
      validations: [],
    },
    data: null,
    results: null,
    standardsSnapshot: [],
    assetSnapshot: {
      baseMeasurementUnit: 'g',
      specifications: {},
    },
    technicianName: 'Tecnico Responsavel',
    approvedBy: 'approver-1',
    approverName: 'Aprovador Tecnico',
    approvedAt: '2026-05-20T10:00:00.000Z',
    performedAt: '2026-05-20T09:00:00.000Z',
    createdAt: '2026-05-19T10:00:00.000Z',
    certificateUrl: '/certificates/7.pdf',
    labelUrl: null,
    ...overrides,
  }
}
