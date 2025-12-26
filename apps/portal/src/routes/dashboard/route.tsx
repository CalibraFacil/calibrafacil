import {
  Link,
  Outlet,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  organization,
  signOut,
  useActiveOrganization,
  useSession,
} from "@calibra-facil/auth/client";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/dashboard")({
  component: DashboardLayout,
});

function getApiBaseUrl(): string {
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `https://${host}:3000`;
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

function DashboardLayout() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization();

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

  useEffect(() => {
    if (!sessionPending && !session) {
      navigate({ to: "/sign-in" });
    }
  }, [sessionPending, session, navigate]);

  useEffect(() => {
    async function enforceClientContext() {
      if (orgsLoading || activeOrgLoading || !hasClientAccess) return;

      const isActiveOrgAllowed =
        activeOrg && clientOrganizations.some((org) => org.id === activeOrg.id);

      if (!isActiveOrgAllowed && clientOrganizations[0]) {
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

  const isActiveOrgAllowed =
    activeOrg && clientOrganizations.some((org) => org.id === activeOrg.id);
  const isSwitchingContext = hasClientAccess && !isActiveOrgAllowed;

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

  if (!hasClientAccess) {
    navigate({ to: "/" });
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <span className="font-semibold">Portal do Cliente</span>
            {activeOrg && (
              <span className="text-sm text-muted-foreground">
                {activeOrg.name}
              </span>
            )}
          </div>
          <nav className="flex items-center gap-4">
            <Link
              to="/dashboard/assets"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Ativos
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {session.user.name}
              </span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Sair
              </Button>
            </div>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto p-4">
        <Outlet />
      </main>
    </div>
  );
}
