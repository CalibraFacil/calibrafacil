import {
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";

import type { QueryClient } from "@tanstack/react-query";

import { Toaster } from "@calibra-facil/ui/sonner";
import { BrandingProvider } from "@/features/branding/branding-context";
import { routeTitle } from "@/lib/route-registry";
import {
  prefetchBranding,
  settleBrandingForFirstPaint,
} from "@/features/branding/queries";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  // Start the lab identity request first thing, so it runs alongside whatever
  // the child routes load (session, organizations) instead of after them.
  beforeLoad: ({ context }) => {
    void prefetchBranding(context.queryClient);
  },
  // Give it a brief head start so the sign-in page renders white-labeled,
  // but never block on it: a failed or slow request leaves the default brand.
  loader: ({ context }) => settleBrandingForFirstPaint(context.queryClient),
  component: RootComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pageTitle = useRouterState({
    select: (state) => routeTitle(state.location.pathname),
  });

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider pageTitle={pageTitle}>
        <Outlet />
        <Toaster richColors position="top-center" />
      </BrandingProvider>
    </QueryClientProvider>
  );
}
