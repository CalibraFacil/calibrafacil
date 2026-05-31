import {
  Navigate,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
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
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { sanitizePortalRedirect } from "@/lib/auth-redirect";
import { getApiBaseUrl } from "@/lib/utils";

const PORTAL_ORG_KEY = "portal-active-org";

export const Route = createFileRoute("/_authenticated")({
  component: PortalLayout,
});

function getWebAppUrl(): string {
  if (import.meta.env.VITE_WEB_URL) {
    return import.meta.env.VITE_WEB_URL;
  }
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return `https://${host}:5173`;
  }
  return "https://calibrafacil.com";
}

type PortalOrganization = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  type: string;
  createdAt: string;
  memberRole: string;
};

function PortalLayout() {
  const navigate = useNavigate();
  const signInRedirect =
    typeof window === "undefined"
      ? "/"
      : sanitizePortalRedirect(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
  const { data: session, isPending: sessionPending } = usePortalSession();
  const { data: activeOrg, isPending: activeOrgLoading } =
    usePortalActiveOrganization();

  // Fetch CLIENT organizations where user has an external portal role
  const { data: clientOrganizations = [], isPending: orgsLoading } = useQuery({
    queryKey: ["portal-organizations"],
    queryFn: async (): Promise<Array<PortalOrganization>> => {
      const response = await fetch(
        `${getApiBaseUrl()}/api/portal/organizations`,
        {
          credentials: "include",
        },
      );
      if (!response.ok) {
        throw new Error("Failed to fetch organizations");
      }
      return response.json();
    },
    enabled: !!session,
  });

  const hasClientAccess = clientOrganizations.length > 0;
  const storedOrgId =
    typeof window !== "undefined" ? localStorage.getItem(PORTAL_ORG_KEY) : null;
  const storedOrg = storedOrgId
    ? (clientOrganizations.find((org) => org.id === storedOrgId) ?? null)
    : null;
  const activeClientOrg =
    activeOrg?.type === "CLIENT"
      ? (clientOrganizations.find((org) => org.id === activeOrg.id) ?? null)
      : null;
  const targetOrg =
    storedOrg ?? activeClientOrg ?? clientOrganizations[0] ?? null;
  const needsPortalOrgSwitch = Boolean(
    session && hasClientAccess && targetOrg && activeOrg?.id !== targetOrg.id,
  );

  // Show loading state
  if (sessionPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" search={{ redirect: signInRedirect }} />;
  }

  if (orgsLoading || activeOrgLoading || needsPortalOrgSwitch) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        {needsPortalOrgSwitch && targetOrg ? (
          <PortalOrgSwitcher key={targetOrg.id} organizationId={targetOrg.id} />
        ) : null}
        <Spinner className="size-8" />
      </div>
    );
  }

  // No CLIENT access - show error page
  if (!hasClientAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Acesso Nao Disponivel</CardTitle>
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
    <SidebarProvider>
      {targetOrg ? (
        <PersistPortalOrgSelection
          key={targetOrg.id}
          organizationId={targetOrg.id}
        />
      ) : null}
      <PortalSidebar />
      <SidebarInset>
        <PortalHeader />
        <main className="flex-1 space-y-4 p-4 2xl:p-6 3xl:px-8">
          {session.user.name.trim() ? null : <CompleteProfilePrompt />}
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function PortalOrgSwitcher({ organizationId }: { organizationId: string }) {
  useMountEffect(() => {
    void portalOrganization.setActive({ organizationId }).then(() => {
      localStorage.setItem(PORTAL_ORG_KEY, organizationId);
    });
  });

  return null;
}

function PersistPortalOrgSelection({
  organizationId,
}: {
  organizationId: string;
}) {
  useMountEffect(() => {
    localStorage.setItem(PORTAL_ORG_KEY, organizationId);
  });

  return null;
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
