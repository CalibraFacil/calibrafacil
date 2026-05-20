import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CommercialStatusBadge } from './status-badge'

function formatMoney(amount?: number | null) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format((amount ?? 0) / 100)
}

export function CommercialOfferSummaryCard(props: {
  preview?: {
    subtotalAmount: number
    discountAmount: number
    totalAmount: number
    recurringAmount: number | null
    providerMode: string
    warnings: string[]
  } | null
  issuedOffer?: {
    id: string
    status: string
    customerCheckoutUrl?: string | null
  } | null
  offerTypeLabel: string
  onCopyLink?: () => void
}) {
  const preview = props.preview

  return (
    <Card>
      <CardHeader>
        <CardTitle>Resumo comercial</CardTitle>
        <CardDescription>Snapshot validado antes da emissão.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="rounded-lg border p-4">
          <p className="text-muted-foreground">Tipo de oferta</p>
          <p className="mt-1 font-medium">{props.offerTypeLabel}</p>
        </div>

        {preview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground">Subtotal</p>
                <p className="mt-1 text-xl font-semibold">
                  {formatMoney(preview.subtotalAmount)}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-muted-foreground">Desconto</p>
                <p className="mt-1 text-xl font-semibold">
                  {formatMoney(preview.discountAmount)}
                </p>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-muted-foreground">Total devido hoje</p>
              <p className="mt-1 text-2xl font-semibold">
                {formatMoney(preview.totalAmount)}
              </p>
              {preview.recurringAmount !== null && (
                <p className="mt-2 text-muted-foreground">
                  Recorrência: {formatMoney(preview.recurringAmount)}
                </p>
              )}
              <p className="mt-2 text-muted-foreground">
                Canal do provedor: {preview.providerMode}
              </p>
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="font-medium text-destructive">Atenções</p>
                <ul className="mt-2 list-disc pl-5 text-destructive">
                  {preview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-muted-foreground">
            Preencha a proposta e use “Pré-visualizar” para ver o snapshot.
          </div>
        )}

        {props.issuedOffer && (
          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-muted-foreground">Oferta emitida</p>
                <p className="font-medium">{props.issuedOffer.id}</p>
              </div>
              <CommercialStatusBadge status={props.issuedOffer.status} />
            </div>
            {props.issuedOffer.customerCheckoutUrl && props.onCopyLink && (
              <Button
                className="mt-3 w-full"
                variant="outline"
                onClick={props.onCopyLink}
              >
                Copiar link do cliente
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
