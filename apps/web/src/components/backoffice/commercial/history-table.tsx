import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CommercialStatusBadge } from './status-badge'

function formatMoney(amount: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(amount / 100)
}

export function CommercialOfferHistoryTable(props: {
  offers: Array<{
    id: string
    kind: string
    status: string
    totalAmount: number
    issuedAt?: string | null
    offerExpiresAt?: string | null
    paidAt?: string | null
    customerCheckoutUrl?: string | null
  }>
  onCopyLink: (offer: { customerCheckoutUrl?: string | null }) => void
  onCancel: (offerId: string) => void
  onReissue: (offerId: string) => void
}) {
  if (props.offers.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
        Nenhuma oferta emitida para esta organização.
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>ID</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Valor</TableHead>
          <TableHead>Emitida em</TableHead>
          <TableHead>Expira em</TableHead>
          <TableHead>Paga em</TableHead>
          <TableHead className="text-right">Ações</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.offers.map((offer) => (
          <TableRow key={offer.id}>
            <TableCell className="font-mono text-xs">{offer.id.slice(0, 8)}</TableCell>
            <TableCell>{offer.kind}</TableCell>
            <TableCell>
              <CommercialStatusBadge status={offer.status} />
            </TableCell>
            <TableCell>{formatMoney(offer.totalAmount)}</TableCell>
            <TableCell>
              {offer.issuedAt ? new Date(offer.issuedAt).toLocaleDateString('pt-BR') : '—'}
            </TableCell>
            <TableCell>
              {offer.offerExpiresAt
                ? new Date(offer.offerExpiresAt).toLocaleDateString('pt-BR')
                : '—'}
            </TableCell>
            <TableCell>
              {offer.paidAt ? new Date(offer.paidAt).toLocaleDateString('pt-BR') : '—'}
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                {offer.customerCheckoutUrl && (
                  <Button size="sm" variant="outline" onClick={() => props.onCopyLink(offer)}>
                    Copiar link
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => props.onReissue(offer.id)}>
                  Reemitir
                </Button>
                {offer.status !== 'PAID' && offer.status !== 'ACTIVATED' && (
                  <Button size="sm" variant="outline" onClick={() => props.onCancel(offer.id)}>
                    Cancelar
                  </Button>
                )}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
