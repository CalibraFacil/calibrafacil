"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { track } from "@/lib/analytics/track";

type TrackedLinkProps = ComponentPropsWithoutRef<"a"> & {
  href: string;
  /** Data-layer event pushed on click (GTM tags fire off it, consent permitting). */
  event: string;
  params?: Record<string, unknown>;
  /** Opens in a new tab with the usual rel hardening. */
  external?: boolean;
};

/**
 * Anchor that records a marketing event on click, so server-rendered sections
 * can hand a tracked CTA to `Button`'s `render` prop. Forwards every prop and
 * the ref so Base UI can merge its own onto it.
 */
export const TrackedLink = forwardRef<HTMLAnchorElement, TrackedLinkProps>(
  function TrackedLink(
    { event, params, external = false, onClick, ...props },
    ref,
  ) {
    return (
      <a
        ref={ref}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        {...props}
        onClick={(clickEvent) => {
          track(event, params);
          onClick?.(clickEvent);
        }}
      />
    );
  },
);
