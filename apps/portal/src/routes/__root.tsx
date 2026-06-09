import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";

import type { QueryClient } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { BrandingProvider } from "@/features/branding/branding-context";
import { brandingQueryOptions } from "@/features/branding/queries";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  // Settle the lab identity before first paint so the sign-in page renders
  // white-labeled (covers every route, including unauthenticated ones).
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(brandingQueryOptions()),
  component: RootComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <Outlet />
        <Toaster richColors position="top-center" />
      </BrandingProvider>
    </QueryClientProvider>
  );
}
