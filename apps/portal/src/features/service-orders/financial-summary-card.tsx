import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { cn } from "../../lib/utils";

export type PortalFinancialSummary = {
  state: "INVOICE_AVAILABLE" | "PAYMENT_PENDING" | "PAID" | "OVERDUE" | null;
  visible: boolean;
  dueDate: string | null;
  paidAt: string | null;
  openAmountCents: number;
  overdueAmountCents: number;
  lastUpdatedAt: string | null;
  freshness: "fresh" | "stale" | "unknown";
  documents: Array<{
    kind: "invoice" | "fiscal_document" | "receipt";
    label: string;
    availableAt: string | null;
    href: string | null;
  }>;
};

export function isFinancialSummary(
  value: unknown,
): value is PortalFinancialSummary {
  if (!value || typeof value !== "object") return false;
  if (!("visible" in value) || typeof value.visible !== "boolean") {
    return false;
  }
  if (!("state" in value)) return false;
  if (!("documents" in value) || !Array.isArray(value.documents)) return false;
  if (
    !("freshness" in value) ||
    (value.freshness !== "fresh" &&
      value.freshness !== "stale" &&
      value.freshness !== "unknown")
  ) {
    return false;
  }
  if (!value.visible) return value.state === null;
  return (
    value.state === "INVOICE_AVAILABLE" ||
    value.state === "PAYMENT_PENDING" ||
    value.state === "PAID" ||
    value.state === "OVERDUE"
  );
}

function formatLongDate(value: string | null | undefined) {
  if (!value) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

function formatMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format((cents ?? 0) / 100);
}

export function financialSummaryLabel(state: PortalFinancialSummary["state"]) {
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

export function financialSummaryDescription(summary: PortalFinancialSummary) {
  const dueDate = formatLongDate(summary.dueDate);
  if (summary.state === "PAID") {
    const paidAt = formatLongDate(summary.paidAt);
    return paidAt
      ? `Pagamento confirmado em ${paidAt}`
      : "Pagamento confirmado";
  }
  if (summary.state === "OVERDUE") {
    const days = summary.dueDate
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(summary.dueDate).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 0;
    return `Vencido há ${days} dias · ${formatMoney(
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
                const availableAt = formatLongDate(document.availableAt);
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
