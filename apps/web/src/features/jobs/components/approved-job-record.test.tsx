// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
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
}))

vi.mock('@/components/method-runtime/math-runtime', () => ({
  normalizeMethodValidations: (validations: unknown) =>
    Array.isArray(validations) ? validations : [],
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

vi.mock('@/features/jobs/queries', () => queryMocks)

vi.mock('@/utils/api', () => ({
  calibraApi: {
    jobs: {
      amend: apiMocks.amend,
      generateLabel: apiMocks.generateLabel,
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

function renderApprovedJobRecord(
  overrides: Partial<ApprovedJobRecordData> = {},
) {
  return render(
    <ApprovedJobRecord
      job={approvedJob(overrides)}
      onBack={vi.fn()}
      onRefresh={vi.fn()}
    />,
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
