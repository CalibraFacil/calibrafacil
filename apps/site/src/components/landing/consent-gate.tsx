"use client";

import dynamic from "next/dynamic";

// Load the consent banner client-only: it reads localStorage in its initial
// state, so server-rendering it would mismatch on hydration for returning
// visitors who already chose.
const ConsentBanner = dynamic(() => import("./consent-banner"), { ssr: false });

export function ConsentGate() {
  return <ConsentBanner />;
}
