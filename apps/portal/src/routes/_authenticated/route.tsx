import {
  Navigate,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  portalOrganization,
  portalSignOut,
  usePortalActiveOrganization,
  usePortalSession,
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
import { useMountEffect } from "@/hooks/use-mount-effect";
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
    ? clientOrganizations.find((org) => org.id === storedOrgId) ?? null
    : null;
  const activeClientOrg =
    activeOrg?.type === "CLIENT"
      ? clientOrganizations.find((org) => org.id === activeOrg.id) ?? null
      : null;
  const targetOrg = storedOrg ?? activeClientOrg ?? clientOrganizations[0] ?? null;
  const needsPortalOrgSwitch = Boolean(
    session &&
      hasClientAccess &&
      targetOrg &&
      activeOrg?.id !== targetOrg.id,
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
    return <Navigate to="/sign-in" />;
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
        <PersistPortalOrgSelection key={targetOrg.id} organizationId={targetOrg.id} />
      ) : null}
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

function PortalOrgSwitcher({ organizationId }: { organizationId: string }) {
  useMountEffect(() => {
    void portalOrganization
      .setActive({ organizationId })
      .then(() => {
        localStorage.setItem(PORTAL_ORG_KEY, organizationId);
      });
  });

  return null;
}

function PersistPortalOrgSelection({ organizationId }: { organizationId: string }) {
  useMountEffect(() => {
    localStorage.setItem(PORTAL_ORG_KEY, organizationId);
  });

  return null;
}
