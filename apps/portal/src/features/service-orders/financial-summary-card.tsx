import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@calibra-facil/ui/card";
import { dateOnlyDaysBetween } from "@calibra-facil/shared/calendar-date";
import {
  formatCalendarDate,
  formatInstant,
  formatMoneyBRL,
} from "@calibra-facil/shared/format";
import type { PortalFinancialSummary } from "@calibra-facil/contracts/portal-client";
import { cn } from "@calibra-facil/ui/utils";

function financialSummaryLabel(state: PortalFinancialSummary["state"]) {
  switch (state) {
    case "INVOICE_AVAILABLE":
      return "Fatura disponível";
    case "PAYMENT_PENDING":
      return "Pagamento pendente";
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Vencido";
    case null:
      return null;
  }
}

function financialSummaryDescription(summary: PortalFinancialSummary) {
  // The due day is a calendar date (stored at UTC midnight); paid and
  // available-at are real moments, shown on the laboratory's day.
  const dueDate = formatCalendarDate(summary.dueDate, "date-long", {
    empty: "",
  });
  if (summary.state === "PAID") {
    const paidAt = formatInstant(summary.paidAt, "date-long", { empty: "" });
    return paidAt
      ? `Pagamento confirmado em ${paidAt}`
      : "Pagamento confirmado";
  }
  if (summary.state === "OVERDUE") {
    const days = summary.dueDate
      ? Math.max(0, -dateOnlyDaysBetween(new Date(), new Date(summary.dueDate)))
      : 0;
    return `Vencido há ${days} dias · ${formatMoneyBRL(
      summary.openAmountCents,
    )} em aberto`;
  }
  if (
    summary.state === "INVOICE_AVAILABLE" ||
    summary.state === "PAYMENT_PENDING"
  ) {
    return dueDate ? `Vence em ${dueDate}` : "Aguardando confirmação";
  }
  return null;
}

export function FinancialSummaryCard({
  summary,
  isLoading,
  isError,
}: {
  summary?: PortalFinancialSummary;
  isLoading?: boolean;
  isError?: boolean;
}) {
  if (summary && !summary.visible) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Financeiro</CardTitle>
          <CardDescription>Carregando informações</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-4 w-32 rounded bg-muted" />
          <div className="h-3 w-44 rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Financeiro</CardTitle>
          <CardDescription>Informações indisponíveis</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!summary.state) return null;

  const description = financialSummaryDescription(summary);
  const label = financialSummaryLabel(summary.state);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financeiro</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <h3
            className={cn(
              "text-sm font-semibold",
              summary.state === "PAID" && "text-emerald-600",
              summary.state === "OVERDUE" &&
                summary.overdueAmountCents > 0 &&
                "text-destructive",
            )}
          >
            {label}
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>

        {summary.documents.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Documentos disponíveis</h3>
            <div className="space-y-1">
              {summary.documents.map((document) => {
                const availableAt = formatInstant(
                  document.availableAt,
                  "date-long",
                  { empty: "" },
                );
                const documentKey = [
                  document.kind,
                  document.label,
                  document.availableAt ?? "sem-data",
                  document.href ?? "sem-link",
                ].join(":");
                const content = (
                  <>
                    <span>{document.label}</span>
                    {availableAt && (
                      <span className="text-muted-foreground">
                        {availableAt}
                      </span>
                    )}
                  </>
                );

                return document.href ? (
                  <a
                    key={documentKey}
                    href={document.href}
                    download
                    aria-label={
                      availableAt
                        ? `${document.label} ${availableAt}`
                        : document.label
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted"
                  >
                    {content}
                  </a>
                ) : (
                  <div
                    key={documentKey}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(summary.freshness === "stale" || summary.freshness === "unknown") && (
          <p className="text-xs text-muted-foreground">Atualização pendente</p>
        )}
      </CardContent>
    </Card>
  );
}
