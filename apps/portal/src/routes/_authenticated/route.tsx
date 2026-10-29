import {
  Navigate,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  getPortalSession,
  portalAuthClient,
  portalOrganization,
  portalSignOut,
  usePortalActiveOrganization,
  usePortalSession,
} from "@calibra-facil/auth/client";
import { translateAuthErrorMessage } from "@calibra-facil/auth/error-messages";
import { toast } from "sonner";
import { PortalSidebar } from "@/components/portal-sidebar";
import { PortalHeader } from "@/components/portal-header";
import { SidebarInset, SidebarProvider } from "@calibra-facil/ui/sidebar";
import { Spinner } from "@calibra-facil/ui/spinner";
import { getWebAppUrl } from "@/lib/runtime-env";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@calibra-facil/ui/card";
import { Button } from "@calibra-facil/ui/button";
import { Input } from "@calibra-facil/ui/input";
import { Label } from "@calibra-facil/ui/label";
import { sanitizePortalRedirect } from "@/lib/auth-redirect";
import { readSessionWithRetry } from "@/lib/auth-session";
import { PortalOrgProvider } from "@/lib/portal-org-context";
import {
  loadPortalStartup,
  parsePortalSession,
  portalOrganizationsQueryOptions,
} from "@/lib/portal-startup";

async function readPortalSession() {
  const result = await readSessionWithRetry(getPortalSession);
  return { data: parsePortalSession(result.data) };
}

async function activatePortalOrganization(organizationId: string) {
  const result = await portalOrganization.setActive({ organizationId });
  // Plain copy on purpose: this runs in the route's beforeLoad, which is part
  // of the initial bundle graph, and the auth message catalog is not.
  if (result.error) {
    throw new Error("Falha ao ativar a organização");
  }
}

export const Route = createFileRoute("/_authenticated")({
  // Settle the session before any authenticated route renders (parity with
  // apps/web). The session, the client organizations and the lab branding are
  // requested together; the only dependent step is activating the right
  // organization, and only when the session does not already point at it. The
  // component below keeps its own session check as defense in depth for
  // sessions lost after load.
  beforeLoad: async ({ context, location, preload }) => {
    if (preload) return { startup: null };

    const startup = await loadPortalStartup({
      queryClient: context.queryClient,
      readSession: readPortalSession,
      setActiveOrganization: activatePortalOrganization,
    });

    if (startup.status === "signed-out") {
      throw redirect({
        to: "/sign-in",
        search: { redirect: sanitizePortalRedirect(location.href) },
      });
    }

    return { startup };
  },
  component: PortalLayout,
});

function PortalLayout() {
  const navigate = useNavigate();
  const { startup } = Route.useRouteContext();
  const signInRedirect =
    typeof window === "undefined"
      ? "/"
      : sanitizePortalRedirect(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
  const { data: liveSession, isPending: sessionPending } = usePortalSession();
  const { data: activeOrg } = usePortalActiveOrganization();

  // Primed by the route's beforeLoad, so this is a cache read on first paint;
  // it only fetches when that entry was invalidated (e.g. an accepted invite).
  const { data: clientOrganizations = [], isPending: orgsLoading } = useQuery(
    portalOrganizationsQueryOptions(),
  );

  // The startup snapshot carries the first paint; the live session takes over
  // as soon as it is known (and signals a session lost after load).
  const session = liveSession ?? startup?.session ?? null;

  if (!startup && sessionPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!session || (!sessionPending && liveSession === null)) {
    return <Navigate to="/sign-in" search={{ redirect: signInRedirect }} />;
  }

  if (orgsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  // No CLIENT access - show error page
  if (clientOrganizations.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Acesso não disponível</CardTitle>
            <CardDescription>
              Você não possui acesso a nenhuma organização de cliente. Se você é
              um usuário do laboratório, acesse o painel principal.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              onClick={() => {
                window.location.href = `${getWebAppUrl()}/dashboard`;
              }}
            >
              Acessar Painel do Laboratório
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await portalSignOut();
                navigate({ to: "/sign-in" });
              }}
            >
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    // Every portal query key is scoped to this id (see portal-query-keys.ts),
    // so one client org's cached data can never be served to another. The
    // live active organization follows the sidebar switcher; until it loads,
    // the organization activated at startup is already the right one.
    <PortalOrgProvider
      organizationId={activeOrg?.id ?? startup?.organizationId ?? null}
    >
      <SidebarProvider>
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:ring-2 focus:ring-ring"
        >
          Pular para o conteúdo
        </a>
        <PortalSidebar />
        <SidebarInset>
          <PortalHeader />
          <main
            id="conteudo"
            tabIndex={-1}
            className="flex-1 space-y-4 p-4 outline-none 2xl:p-6 3xl:px-8"
          >
            {session.user.name?.trim() ? null : <CompleteProfilePrompt />}
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </PortalOrgProvider>
  );
}

function CompleteProfilePrompt() {
  const [name, setName] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (dismissed) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName) {
      toast.error("Informe seu nome para atualizar o perfil");
      return;
    }

    setSubmitting(true);

    try {
      const result = await portalAuthClient.updateUser({ name: trimmedName });

      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            "Falha ao atualizar perfil",
          ),
        );
      }

      toast.success("Perfil atualizado");
      setDismissed(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Falha ao atualizar perfil",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Complete seu perfil</CardTitle>
        <CardDescription>
          Informe seu nome para identificar suas ações no portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <div className="grid flex-1 gap-2">
            <Label htmlFor="portal-profile-name">Nome completo</Label>
            <Input
              id="portal-profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Seu nome"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button
              type="submit"
              disabled={submitting}
              className="active:scale-[0.96] transition-transform"
            >
              {submitting ? (
                <>
                  <Spinner className="mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDismissed(true)}
            >
              Depois
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
