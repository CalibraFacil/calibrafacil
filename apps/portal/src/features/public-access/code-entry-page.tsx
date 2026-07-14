import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import {
  ACTION_BUTTON_CLASS,
  BlueprintOverlay,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { redeemAccessCode } from "./queries";

type EntryError = "invalid" | "throttled" | null;

const ERROR_COPY: Record<Exclude<EntryError, null>, string> = {
  invalid:
    "Código inválido ou expirado. Verifique o código no e-mail recebido.",
  throttled: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
};

/**
 * Public `/access-code` page (spec quote-approval-public-access,
 * REQ-QPUB-040/041): the customer types the 8-char approval code printed in
 * the quote email and lands on the tokenized quote page. Error states are
 * persistent — they only clear when the customer edits the code or submits
 * again, never silently.
 */
export function CodeEntryPage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<EntryError>(null);

  const redeemMutation = useMutation({
    mutationFn: redeemAccessCode,
    onSuccess: (result) => {
      if (result.kind === "ok") {
        void navigate({
          to: "/service-order-access/$token",
          params: { token: result.token },
        });
        return;
      }
      setError(result.kind);
    },
    onError: () => {
      setError("invalid");
    },
  });

  const normalized = code.toUpperCase();
  const canSubmit =
    normalized.replace(/[\s-]/g, "").length >= 8 && !redeemMutation.isPending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    redeemMutation.mutate(normalized);
  }

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <main className="portal-shell-sm">
        <Panel className="relative mx-auto max-w-xl overflow-hidden p-6 sm:p-8">
          <BlueprintOverlay />
          <div className="relative space-y-6">
            <PanelHeader
              eyebrow="Acesso ao orçamento"
              title="Acessar orçamento com código"
              description="Digite o código de aprovação enviado junto com o orçamento por e-mail."
            />

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <Input
                value={normalized}
                onChange={(event) => {
                  setCode(event.target.value);
                  setError(null);
                }}
                placeholder="EX.: K7WM3P9A"
                aria-label="Código de aprovação"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={12}
                className="h-12 text-center font-mono text-lg uppercase tracking-[0.3em]"
              />

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {ERROR_COPY[error]}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={!canSubmit}
                className={cn(ACTION_BUTTON_CLASS, "w-full")}
              >
                {redeemMutation.isPending
                  ? "Verificando..."
                  : "Acessar orçamento"}
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">
              O código tem 8 letras e números. Espaços e hífens são ignorados.
              Ele deixa de funcionar quando o orçamento é respondido ou expira.
            </p>
          </div>
        </Panel>
      </main>
    </div>
  );
}
