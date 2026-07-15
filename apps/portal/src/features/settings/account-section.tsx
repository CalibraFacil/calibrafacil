import { HugeiconsIcon } from "@hugeicons/react";
import { Logout01Icon } from "@hugeicons/core-free-icons";

import {
  portalSignOut,
  usePortalActiveOrganization,
  usePortalSession,
} from "@calibra-facil/auth/client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
} from "@/components/instrument-panel";

function getInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function AccountSection() {
  const { data: session, isPending } = usePortalSession();
  const { data: activeOrg } = usePortalActiveOrganization();

  const handleSignOut = async () => {
    await portalSignOut({
      fetchOptions: {
        onSuccess: () => {
          window.location.href = "/sign-in";
        },
      },
    });
  };

  if (isPending) {
    return (
      <Panel className="space-y-4 p-5">
        <Skeleton className="h-5 w-32" />
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Skeleton className="h-16 w-full" />
      </Panel>
    );
  }

  const user = session?.user;
  if (!user) return null;

  return (
    <Panel className="relative overflow-hidden p-5">
      <BlueprintOverlay />
      <div className="relative">
        <PanelHeader
          title="Conta"
          description="Seus dados de acesso ao portal do cliente."
          action={
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              <HugeiconsIcon icon={Logout01Icon} strokeWidth={2} />
              Sair
            </Button>
          }
        />
        <div className="mt-4 flex items-center gap-4">
          <Avatar className="size-14 rounded-xl">
            <AvatarImage src={user.image ?? ""} alt={user.name} />
            <AvatarFallback className="rounded-xl text-base font-semibold">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{user.name}</p>
            <p className="text-muted-foreground truncate text-sm">
              {user.email}
            </p>
          </div>
        </div>
        <BlueprintGrid className="mt-5 sm:grid-cols-2">
          <BlueprintField label="Organização">
            {activeOrg?.name ?? "Nenhuma selecionada"}
          </BlueprintField>
          <BlueprintField label="Acesso">Portal do cliente</BlueprintField>
        </BlueprintGrid>
      </div>
    </Panel>
  );
}
