import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { formatMoney } from "@calibra-facil/shared";

import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from "@/components/instrument-panel";
import type { SignalTone } from "@/components/instrument-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { usePublicServiceOrder, submitQuoteDecision } from "./queries";
import type { QuoteDecision } from "./queries";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR");
}

const QUOTE_STATUS_TONE: Record<string, SignalTone> = {
  sent: "info",
  approved: "ok",
  rejected: "critical",
  expired: "warning",
};

const QUOTE_STATUS_LABEL: Record<string, string> = {
  sent: "Aguardando resposta",
  approved: "Aprovado",
  rejected: "Recusado",
  expired: "Expirado",
};

/**
 * Public tokenized quote page (spec quote-approval-public-access, mini-spec E):
 * `/service-order-access/$token`, no sign-in — the token is the credential.
 *
 * - REQ-QPUB-042: instrument-panel design system, not plain cards.
 * - REQ-QPUB-043: after approve/reject the page renders a terminal
 *   confirmation from local state + the already-fetched snapshot. It must NOT
 *   refetch: the decision revoked the token, a refetch would 410.
 * - REQ-QPUB-044: a 410 from the API renders the "orçamento já respondido"
 *   state, without pricing.
 */
export function PublicQuotePage({ token }: { token: string }) {
  const orderQuery = usePublicServiceOrder(token);
  const [decision, setDecision] = useState<QuoteDecision | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const decisionMutation = useMutation({
    mutationFn: submitQuoteDecision,
    onSuccess: (made) => {
      // REQ-QPUB-043: terminal state from local data — no query invalidation.
      setDecision(made);
      setRejectOpen(false);
      setDecisionError(null);
    },
    onError: (error) => {
      setDecisionError(
        error instanceof Error ? error.message : "Erro ao enviar resposta.",
      );
    },
  });

  if (orderQuery.isLoading) {
    return (
      <PageShell>
        <Panel className="p-6 text-sm text-muted-foreground">
          Carregando ordem de serviço...
        </Panel>
      </PageShell>
    );
  }

  const result = orderQuery.data;

  if (!result || result.kind === "invalid") {
    return (
      <PageShell>
        <Panel className="relative overflow-hidden p-6 sm:p-8">
          <BlueprintOverlay />
          <div className="relative">
            <PanelHeader
              eyebrow="Acesso ao orçamento"
              title="Link indisponível"
              description="Este link é inválido, expirou ou foi substituído por um orçamento mais recente. Verifique o e-mail mais recente enviado pelo laboratório."
            />
          </div>
        </Panel>
      </PageShell>
    );
  }

  if (result.kind === "responded") {
    return (
      <PageShell>
        <Panel className="relative overflow-hidden p-6 sm:p-8">
          <BlueprintOverlay />
          <div className="relative">
            <PanelHeader
              eyebrow="Acesso ao orçamento"
              title="Orçamento já respondido"
              description="Este orçamento já foi aprovado ou recusado e o link deixou de dar acesso aos detalhes. Em caso de dúvida, entre em contato com o laboratório."
            />
          </div>
        </Panel>
      </PageShell>
    );
  }

  const order = result.order;
  const quote = order.quotes[0];
  const evaluation = order.evaluations[0];
  const specs = order.assetSnapshot?.displaySpecs ?? [];
  const canAnswer = quote?.status === "sent" && decision === null;

  const quoteTone: SignalTone = decision
    ? decision === "approved"
      ? "ok"
      : "critical"
    : (QUOTE_STATUS_TONE[quote?.status ?? ""] ?? "neutral");
  const quoteStatusLabel = decision
    ? decision === "approved"
      ? "Aprovado"
      : "Recusado"
    : (QUOTE_STATUS_LABEL[quote?.status ?? ""] ?? quote?.status ?? "—");

  return (
    <PageShell>
      <StaggerGroup className="space-y-5">
        {/* Header */}
        <StaggerItem>
          <Panel className="relative overflow-hidden p-6 sm:p-8">
            <BlueprintOverlay />
            <div className="relative">
              <PanelHeader
                eyebrow="Ordem de serviço"
                title={order.serviceOrderNumber}
                description={`Entrada em ${formatDate(order.openedAt)}`}
                action={
                  <span className="rounded-full bg-muted px-3 py-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    {decision
                      ? decision === "approved"
                        ? "Orçamento aprovado"
                        : "Orçamento recusado"
                      : (order.statusLabel ?? order.status)}
                  </span>
                }
              />
            </div>
          </Panel>
        </StaggerItem>

        {/* Terminal confirmation (REQ-QPUB-043) — rendered from local state */}
        {decision ? (
          <StaggerItem>
            <Panel className="p-6 sm:p-8">
              <PanelHeader
                eyebrow="Resposta registrada"
                title={
                  decision === "approved"
                    ? "Orçamento aprovado"
                    : "Orçamento recusado"
                }
                description={
                  decision === "approved"
                    ? "Obrigado! O laboratório foi notificado e dará seguimento ao serviço."
                    : "Sua recusa foi registrada. O laboratório foi notificado e poderá entrar em contato."
                }
              />
              {quote ? (
                <div className="mt-4 max-w-xs">
                  <SignalTile
                    label="Total do orçamento"
                    value={formatMoney(quote.totalCents)}
                    hint={quote.quoteNumber}
                    tone={quoteTone}
                  />
                </div>
              ) : null}
              <p className="mt-4 text-xs text-muted-foreground">
                Este link deixará de dar acesso aos detalhes do orçamento.
              </p>
            </Panel>
          </StaggerItem>
        ) : null}

        {/* Instrument identification */}
        <StaggerItem>
          <Panel className="p-6 sm:p-8">
            <PanelHeader eyebrow="Instrumento" title="Identificação" />
            <BlueprintGrid className="mt-4 grid-cols-1 sm:grid-cols-2">
              <BlueprintField label="Instrumento">
                {order.assetSnapshot?.assetName?.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Fabricante / Modelo">
                {[order.assetSnapshot?.manufacturer, order.assetSnapshot?.model]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </BlueprintField>
              <BlueprintField label="Número de série" mono>
                {order.assetSnapshot?.serialNumber?.trim() || "—"}
              </BlueprintField>
              <BlueprintField label="Defeito reclamado">
                {order.claimedDefect?.trim() || "—"}
              </BlueprintField>
              {specs.map((spec) => (
                <BlueprintField key={spec.label} label={spec.label} mono>
                  {spec.value}
                </BlueprintField>
              ))}
            </BlueprintGrid>
          </Panel>
        </StaggerItem>

        {/* Technical evaluation */}
        {evaluation ? (
          <StaggerItem>
            <Panel className="p-6 sm:p-8">
              <PanelHeader
                eyebrow="Avaliação técnica"
                title="Diagnóstico do laboratório"
                description={
                  evaluation.evaluatedAt
                    ? `Avaliado em ${formatDate(evaluation.evaluatedAt)}`
                    : undefined
                }
              />
              <BlueprintGrid className="mt-4 grid-cols-1">
                <BlueprintField label="Diagnóstico">
                  {evaluation.diagnosis?.trim() || "—"}
                </BlueprintField>
                {evaluation.clientVisibleNotes?.trim() ? (
                  <BlueprintField label="Observações">
                    {evaluation.clientVisibleNotes}
                  </BlueprintField>
                ) : null}
              </BlueprintGrid>
            </Panel>
          </StaggerItem>
        ) : null}

        {/* Quote */}
        <StaggerItem>
          <Panel className="p-6 sm:p-8">
            <PanelHeader
              eyebrow="Orçamento"
              title={
                quote ? `${quote.quoteNumber} · v${quote.version}` : "Orçamento"
              }
              description={
                quote?.validUntil
                  ? `Válido até ${formatDate(quote.validUntil)}`
                  : undefined
              }
            />

            {quote ? (
              <div className="mt-4 space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <SignalTile
                    label="Total"
                    value={formatMoney(quote.totalCents)}
                    tone={quoteTone}
                  />
                  <SignalTile
                    label="Situação"
                    value={quoteStatusLabel}
                    tone={quoteTone}
                  />
                </div>

                {quote.clientMessage?.trim() ? (
                  <p className="text-sm text-muted-foreground">
                    {quote.clientMessage}
                  </p>
                ) : null}

                <ul className="divide-y divide-foreground/10">
                  {quote.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-start justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {item.description}
                        </p>
                        <p className="font-mono text-xs tabular-nums text-muted-foreground">
                          {item.quantity ?? 1} {item.unit ?? "un"} ×{" "}
                          {formatMoney(item.unitPriceCents)}
                        </p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-semibold tabular-nums">
                        {formatMoney(item.totalPriceCents)}
                      </p>
                    </li>
                  ))}
                </ul>

                {quote.warrantyTerms?.trim() ? (
                  <p className="text-xs text-muted-foreground">
                    Garantia: {quote.warrantyTerms}
                  </p>
                ) : null}

                {canAnswer ? (
                  <>
                    <div className="flex flex-col-reverse gap-2 border-t border-foreground/10 pt-5 sm:flex-row sm:justify-end">
                      <Button
                        variant="destructive"
                        onClick={() => setRejectOpen(true)}
                        disabled={decisionMutation.isPending}
                        className={ACTION_BUTTON_CLASS}
                      >
                        Recusar orçamento
                      </Button>
                      <Button
                        onClick={() =>
                          decisionMutation.mutate({
                            token,
                            decision: "approved",
                          })
                        }
                        disabled={decisionMutation.isPending}
                        className={cn(ACTION_BUTTON_CLASS, "sm:min-w-52")}
                      >
                        Aprovar orçamento
                      </Button>
                    </div>

                    <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Recusar este orçamento?</DialogTitle>
                          <DialogDescription>
                            A recusa encerra esta versão do orçamento e este
                            link deixa de funcionar. Não se preocupe: o
                            laboratório será notificado e pode enviar uma nova
                            versão para aprovação.
                          </DialogDescription>
                        </DialogHeader>
                        <Textarea
                          value={rejectionReason}
                          onChange={(event) =>
                            setRejectionReason(event.target.value)
                          }
                          placeholder="Motivo da recusa (opcional)"
                          aria-label="Motivo da recusa"
                        />
                        <DialogFooter>
                          <DialogClose render={<Button variant="outline" />}>
                            Voltar
                          </DialogClose>
                          <Button
                            variant="destructive"
                            onClick={() =>
                              decisionMutation.mutate({
                                token,
                                decision: "rejected",
                                rejectionReason,
                              })
                            }
                            disabled={decisionMutation.isPending}
                          >
                            {decisionMutation.isPending
                              ? "Enviando..."
                              : "Confirmar recusa"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </>
                ) : null}

                {decisionError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {decisionError}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Nenhum orçamento foi publicado para este link.
              </p>
            )}
          </Panel>
        </StaggerItem>
      </StaggerGroup>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:py-12">
      <main className="portal-shell-sm">{children}</main>
    </div>
  );
}
