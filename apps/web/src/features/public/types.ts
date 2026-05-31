export type InvitationData = {
  id: string
  email: string
  role: string
  status: string
  expiresAt: Date
  organizationId: string
  organizationName: string
  organizationSlug: string
  inviterEmail: string
}

export type CheckoutState =
  | 'INVALID'
  | 'EXPIRED'
  | 'REVOKED'
  | 'AWAITING_PAYMENT'
  | 'PIX_READY'
  | 'BOLETO_READY'
  | 'PAID'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'CANCELED'

export type PublicCheckoutSnapshotData =
  | {
      state: 'INVALID'
      offer: null
      presentation: null
    }
  | {
      state: CheckoutState
      offer: {
        id: string
        status: string
        kind: 'SETUP_FEE' | 'PLAN_UPFRONT' | 'PLAN_RECURRING'
        paymentMethod: 'PIX' | 'BOLETO' | 'CREDIT_CARD'
        providerMode: 'CHECKOUT' | 'PAYMENT' | 'SUBSCRIPTION'
        currency: string
        totalAmount: number
        recurringAmount: number | null
        dueDate: string | null
        offerExpiresAt: string | null
        issuedAt: string | null
        paidAt: string | null
        customerVisibleDescription: string | null
        items: Array<{
          id: number
          type: string
          label: string
          description: string | null
          quantity: number
          unitAmount: number
          totalAmount: number
        }>
        seller: {
          name: string
          cnpj: string | null
          email: string | null
          phone: string | null
          website: string | null
          city: string | null
          state: string | null
        }
        payer: {
          name: string | null
          email: string | null
          phone: string | null
          taxId: string | null
        }
      }
      presentation: PublicCheckoutPresentation
    }

export type PublicCheckoutPresentation =
  | {
      type: 'PIX'
      paymentId: number | null
      providerPaymentId: string | null
      providerUrl: string | null
      pix: {
        qrCodeImage: string | null
        payload: string | null
        expirationDate: string | null
      }
      boleto: null
    }
  | {
      type: 'BOLETO'
      paymentId: number | null
      providerPaymentId: string | null
      providerUrl: string | null
      pix: null
      boleto: {
        bankSlipUrl: string | null
        identificationField: string | null
        dueDate: string | null
        amount: number
      }
    }
  | {
      type: 'REDIRECT' | null
      paymentId: number | null
      providerPaymentId: string | null
      providerUrl: string | null
      pix: null
      boleto: null
    }
  | null

export type PublicCheckoutStatusData = {
  state: CheckoutState
  paymentId: number | null
  status: string | null
  paidAt: string | null
  presentation: PublicCheckoutPresentation
}

export type PublicCheckoutStartResponse =
  | {
      type: 'PAID'
      state: 'PAID'
      paymentId: number | null
    }
  | {
      type: 'PIX_READY'
      state: 'PIX_READY'
      paymentId: number
      pix: {
        qrCodeImage: string | null
        payload: string | null
        expirationDate: string | null
      }
    }
  | {
      type: 'BOLETO_READY'
      state: 'BOLETO_READY'
      paymentId: number
      boleto: {
        bankSlipUrl: string | null
        identificationField: string | null
        dueDate: string | null
        amount: number
      }
    }
  | {
      type: 'REDIRECT'
      state: 'AWAITING_PAYMENT'
      providerUrl: string
      paymentId: number | null
    }
