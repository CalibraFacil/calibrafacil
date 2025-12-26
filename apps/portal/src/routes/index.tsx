import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  organization,
  signOut,
  useActiveOrganization,
  useSession,
} from "@calibra-facil/auth/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/")({
  component: PortalHome,
});

// API base URL helper
function getApiBaseUrl(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "localhost";
  return `https://${host}:3000`;
}

// Type for portal organization response
type PortalOrganization = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  type: string;
  createdAt: string;
  memberRole: string;
};

function PortalHome() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();
  const { data: activeOrg, isPending: activeOrgLoading } =
    useActiveOrganization();

  // Fetch CLIENT organizations where user is a client_user (not owner/admin)
  // This ensures lab admins don't see CLIENT orgs they created
  const { data: clientOrganizations = [], isPending: orgsLoading } = useQuery({
    queryKey: ["portal-organizations"],
    queryFn: async (): Promise<Array<PortalOrganization>> => {
      const response = await fetch(`${getApiBaseUrl()}/api/portal/organizations`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to fetch organizations");
      }
      return response.json();
    },
    enabled: !!session, // Only fetch when authenticated
  });

  const hasClientAccess = clientOrganizations.length > 0;

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!sessionPending && !session) {
      navigate({ to: "/sign-in" });
    }
  }, [sessionPending, session, navigate]);

  // Context Enforcer: Auto-switch to a CLIENT org where user is client_user
  // Checks if activeOrg is in our allowed list (filtered by role)
  useEffect(() => {
    async function enforceClientContext() {
      if (orgsLoading || activeOrgLoading || !hasClientAccess) return;

      // Check if active org is in our allowed CLIENT orgs list
      const isActiveOrgAllowed = activeOrg &&
        clientOrganizations.some((org) => org.id === activeOrg.id);

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
  const isActiveOrgAllowed = activeOrg &&
    clientOrganizations.some((org) => org.id === activeOrg.id);
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
            <CardTitle className="text-2xl">Acesso Não Disponível</CardTitle>
            <CardDescription>
              Você não possui acesso a nenhuma organização cliente. Se você é um
              usuário do laboratório, acesse o painel principal.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Button
              onClick={() => {
                // Redirect to main dashboard
                const host = window.location.hostname;
                window.location.href = `https://${host}:5173/dashboard`;
              }}
            >
              Acessar Painel do Laboratório
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
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

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            Bem-vindo, {session.user.name}!
          </CardTitle>
          <CardDescription>
            Você está conectado ao Portal do Cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-muted-foreground">
            Em breve você poderá visualizar suas calibrações e certificados
            aqui.
          </p>
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
