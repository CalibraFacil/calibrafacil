// @vitest-environment jsdom

import { cleanup, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  forgetDesktopBridge,
  renderOnDesktop,
} from '@/runtime/desktop-connectivity-test-support'
import type { StandardDetail } from '@/features/standards/types'

import { StandardCertificateDocumentPanel } from './standard-certificate-document-panel'

// The standard's certificate PDF is stored in the cloud, so uploading,
// replacing and downloading it are online-only since Q13. The standard detail
// page itself stays readable offline; on a disconnected desktop these buttons
// must be disabled instead of failing with a network error.

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/runtime/desktop', () => ({ isDesktopRuntime: () => true }))

vi.mock('@/utils/api', () => ({ calibraApi: { standards: {} } }))

const standard: StandardDetail = {
  id: 3,
  name: 'Massa padrão 1 kg',
  kind: 'mass_single',
  type: null,
  serialNumber: 'STD-001',
  manufacturer: null,
  model: null,
  certificateNumber: 'CERT-001',
  calibratedBy: null,
  calibrationDate: '2026-01-15T00:00:00.000Z',
  nextCalibrationDate: '2027-01-15T00:00:00.000Z',
  referenceValue: 1000,
  uncertainty: 0.01,
  uncertaintyUnit: 'g',
  coverageFactor: 2,
  distribution: 'normal',
  drift: null,
  certifiedValues: null,
  metrologyData: null,
  certificateDocument: {
    documentId: 9,
    r2Key: 'standards/3/cert.pdf',
    fileName: 'cert.pdf',
    fileSize: 20480,
    sha256: 'abc',
    uploadedAt: '2026-01-16T00:00:00.000Z',
    certificateNumber: 'CERT-001',
    calibrationDate: '2026-01-15T00:00:00.000Z',
    nextCalibrationDate: '2027-01-15T00:00:00.000Z',
  },
  status: 'ACTIVE',
  isExpired: false,
  daysUntilExpiry: 300,
  createdAt: '2026-01-10T00:00:00.000Z',
  updatedAt: '2026-01-10T00:00:00.000Z',
}

const ACTIONS = ['Substituir PDF', 'Baixar'] as const

describe('standard certificate document panel on a disconnected desktop (Q13)', () => {
  beforeEach(forgetDesktopBridge)
  afterEach(() => {
    cleanup()
    forgetDesktopBridge()
  })

  it.each(ACTIONS)('"%s" is enabled while connected (control)', (action) => {
    renderOnDesktop(
      <StandardCertificateDocumentPanel standard={standard} />,
      'online',
    )

    expect(
      screen.getByRole('button', { name: action }).hasAttribute('disabled'),
    ).toBe(false)
  })

  it.each(ACTIONS)('"%s" is disabled with no connection', (action) => {
    renderOnDesktop(
      <StandardCertificateDocumentPanel standard={standard} />,
      'offline',
    )

    expect(
      screen.getByRole('button', { name: action }).hasAttribute('disabled'),
    ).toBe(true)
  })

  it('disables the first upload too, and still shows what is on file', () => {
    renderOnDesktop(
      <StandardCertificateDocumentPanel
        standard={{ ...standard, certificateDocument: null }}
      />,
      'offline',
    )

    expect(
      screen
        .getByRole('button', { name: 'Enviar PDF' })
        .hasAttribute('disabled'),
    ).toBe(true)
    expect(
      screen.getByText('Nenhum PDF enviado para este padrão.'),
    ).toBeTruthy()
  })
})
