import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";

import type { QueryClient } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { BrandingProvider } from "@/features/branding/branding-context";
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

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <Outlet />
        <Toaster richColors position="top-center" />
      </BrandingProvider>
    </QueryClientProvider>
  );
}
