import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  portalOrganization,
  usePortalActiveOrganization,
  usePortalSession,
  portalSignOut,
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

const PORTAL_ORG_KEY = "portal-active-org";

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
  const { data: session, isPending: sessionPending } = usePortalSession();
  const { data: activeOrg, isPending: activeOrgLoading } =
    usePortalActiveOrganization();

  // Track if we've already done initial context setup
  const hasSetupContext = useRef(false);
  const [isSettingUp, setIsSettingUp] = useState(true);

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

  // Context Setup: Only runs once on initial load
  // Uses localStorage to remember preferred org, avoiding conflicts with dashboard
  useEffect(() => {
    async function setupPortalContext() {
      if (
        orgsLoading ||
        activeOrgLoading ||
        !session ||
        hasSetupContext.current
      )
        return;
      if (!hasClientAccess) {
        setIsSettingUp(false);
        return;
      }

      hasSetupContext.current = true;

      // Get stored preference for portal
      const storedOrgId = localStorage.getItem(PORTAL_ORG_KEY);

      // Check if stored org is a valid CLIENT org
      const storedOrg = storedOrgId
        ? clientOrganizations.find((org) => org.id === storedOrgId)
        : null;

      // Determine target org: stored preference > current if CLIENT > first CLIENT
      let targetOrg = storedOrg;
      if (!targetOrg) {
        targetOrg = clientOrganizations.find((org) => org.id === activeOrg?.id);
      }
      if (!targetOrg) {
        targetOrg = clientOrganizations[0];
      }

      // Only switch if needed
      if (targetOrg && activeOrg?.id !== targetOrg.id) {
        await portalOrganization.setActive({ organizationId: targetOrg.id });
        localStorage.setItem(PORTAL_ORG_KEY, targetOrg.id);
      } else if (targetOrg) {
        // Store current selection
        localStorage.setItem(PORTAL_ORG_KEY, targetOrg.id);
      }

      setIsSettingUp(false);
    }

    setupPortalContext();
  }, [
    session,
    orgsLoading,
    activeOrgLoading,
    hasClientAccess,
    activeOrg,
    clientOrganizations,
  ]);

  // Show loading state
  if (
    sessionPending ||
    !session ||
    orgsLoading ||
    activeOrgLoading ||
    isSettingUp
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
