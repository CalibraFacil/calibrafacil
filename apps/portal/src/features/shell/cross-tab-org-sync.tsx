import { useQueryClient } from "@tanstack/react-query";
import { portalOrganization } from "@calibra-facil/auth/client";
import { useMountEffect } from "@calibra-facil/ui/use-mount-effect";

import { watchOtherTabOrganization } from "@/lib/portal-org-sync";

/** Follows the organization another portal tab switched to. */
export function CrossTabOrgSync() {
  const queryClient = useQueryClient();

  useMountEffect(() =>
    watchOtherTabOrganization(queryClient, (input) =>
      portalOrganization.setActive(input),
    ),
  );

  return null;
}
