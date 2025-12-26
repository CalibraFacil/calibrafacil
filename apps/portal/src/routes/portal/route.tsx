import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  organization,
  useActiveOrganization,
  useSession,
} from "@calibra-facil/auth/client";
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

export const Route = createFileRoute("/portal")({
  component: PortalLayout,
});

function getApiBaseUrl(): string {
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `https://${host}:3000`;
}

function getWebAppUrl(): string {
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `https://${host}:5173`;
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
  const { data: session, isPending: sessionPending } = useSession();
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization();

  // Fetch CLIENT organizations where user is a client_user (not owner/admin)
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

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!sessionPending && !session) {
      navigate({ to: "/sign-in" });
    }
  }, [sessionPending, session, navigate]);

  // Context Enforcer: Auto-switch to a CLIENT org where user is client_user
  useEffect(() => {
    async function enforceClientContext() {
      if (orgsLoading || activeOrgLoading || !hasClientAccess) return;

      // Check if active org is in our allowed CLIENT orgs list
      const isActiveOrgAllowed =
        activeOrg && clientOrganizations.some((org) => org.id === activeOrg.id);

      if (!isActiveOrgAllowed && clientOrganizations[0]) {
        // Auto-switch to first allowed CLIENT organization
        await organization.setActive({
          organizationId: clientOrganizations[0].id,
        });
      }
    }

    if (session) {
      enforceClientContext();
    }
  }, [
    session,
    orgsLoading,
    activeOrgLoading,
    hasClientAccess,
    activeOrg,
    clientOrganizations,
  ]);

  // Check if we're in the middle of switching contexts
  const isActiveOrgAllowed =
    activeOrg && clientOrganizations.some((org) => org.id === activeOrg.id);
  const isSwitchingContext = hasClientAccess && !isActiveOrgAllowed;

  // Show loading state
  if (
    sessionPending ||
    !session ||
    orgsLoading ||
    activeOrgLoading ||
    isSwitchingContext
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
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
              Voce nao possui acesso a nenhuma organizacao cliente. Se voce e um
              usuario do laboratorio, acesse o painel principal.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              onClick={() => {
                window.location.href = `${getWebAppUrl()}/dashboard`;
              }}
            >
              Acessar Painel do Laboratorio
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const { signOut } = await import("@calibra-facil/auth/client");
                await signOut();
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
      <PortalSidebar />
      <SidebarInset>
        <PortalHeader />
        <main className="flex-1 p-4">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
