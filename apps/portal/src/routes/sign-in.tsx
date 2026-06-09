import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { portalAuthClient } from "@calibra-facil/auth/client";
import { translateAuthErrorMessage } from "@calibra-facil/auth/error-messages";
import { z } from "zod";

import { BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { sanitizePortalRedirect } from "@/lib/auth-redirect";

const searchSchema = z.object({
  redirect: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute("/sign-in")({
  validateSearch: searchSchema,
  component: SignInPage,
});

function SignInPage() {
  const { redirect, error: magicLinkError } = Route.useSearch();

  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const safeRedirect = sanitizePortalRedirect(redirect);

  function getCallbackURL() {
    if (typeof window === "undefined") return safeRedirect;

    return new URL(safeRedirect, window.location.origin).toString();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await portalAuthClient.signIn.magicLink({
      email: normalizedEmail,
      callbackURL: getCallbackURL(),
      errorCallbackURL:
        typeof window !== "undefined"
          ? `${window.location.origin}/sign-in?error=magic-link`
          : undefined,
    });

    setIsLoading(false);

    if (error) {
      setError(
        translateAuthErrorMessage(
          error.message,
          "Falha ao enviar link de acesso",
        ),
      );
      return;
    }

    setSentTo(normalizedEmail);
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex flex-1 items-center justify-center">
          <form
            onSubmit={handleSubmit}
            className="flex w-full max-w-xs flex-col gap-6"
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <BrandLockup markClassName="h-16" textClassName="text-2xl" />
              <h1 className="text-2xl font-bold">Portal do Cliente</h1>
              <p className="text-muted-foreground text-sm text-balance">
                Informe seu email para receber um link seguro de acesso.
              </p>
            </div>

            {magicLinkError && !error && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                Link inválido ou expirado. Solicite um novo link de acesso.
              </div>
            )}

            {error && (
              <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                {error}
              </div>
            )}

            {sentTo ? (
              <div className="bg-primary/10 text-primary rounded-md p-4 text-sm">
                Enviamos um link de acesso para <strong>{sentTo}</strong>. Ele
                expira em poucos minutos.
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <Button
              type="submit"
              disabled={isLoading}
              className="active:scale-[0.96] transition-transform"
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2" />
                  Enviando...
                </>
              ) : (
                "Receber link de acesso"
              )}
            </Button>

            {sentTo ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSentTo(null);
                  setError(null);
                }}
              >
                Usar outro email
              </Button>
            ) : null}

            <p className="text-center text-sm text-muted-foreground text-balance">
              Não possui uma conta? Entre em contato com o laboratório para
              receber um convite de acesso.
            </p>
          </form>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-muted p-10 lg:flex lg:flex-col lg:items-center lg:justify-center">
        <div className="absolute inset-0 bg-linear-to-br from-primary/10 via-muted to-chart-1/10" />
        <div className="absolute -top-1/2 -left-1/2 h-full w-full rounded-full bg-chart-1/20 blur-[100px]" />
        <div className="absolute -right-1/2 -bottom-1/2 h-full w-full rounded-full bg-primary/20 blur-[100px]" />

        <div className="relative z-10 mt-auto max-w-md space-y-3">
          <p className="text-2xl font-semibold tracking-tight text-balance">
            Tudo da sua calibração em um só lugar
          </p>
          <p className="text-muted-foreground text-base text-balance">
            Consulte certificados, acompanhe o status dos seus equipamentos e
            baixe documentos a qualquer momento.
          </p>
        </div>
      </div>
    </div>
  );
}
