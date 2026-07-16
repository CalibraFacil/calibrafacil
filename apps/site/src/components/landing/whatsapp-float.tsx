"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { WhatsappIcon } from "@hugeicons/core-free-icons";

import { track } from "@/lib/analytics/track";

// Floating WhatsApp CTA shown on every marketing page. Reuses the number and
// the whatsapp_click event that already exist in the footer — this just makes
// the channel visible instead of buried at the bottom of the page. Sits below
// the consent banner (z-[60]) so it never blocks the LGPD choice.
const WHATSAPP_HREF = `https://wa.me/5551900000000?text=${encodeURIComponent(
  "Olá! Vim pelo site do CalibraFácil e queria saber mais sobre o sistema.",
)}`;

export function WhatsAppFloat() {
  return (
    <a
      href={WHATSAPP_HREF}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Falar no WhatsApp"
      onClick={() => track("whatsapp_click", { location: "float" })}
      className="fixed right-5 bottom-5 z-40 flex size-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg shadow-black/25 ring-1 ring-black/5 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366] motion-reduce:transition-none"
    >
      <HugeiconsIcon icon={WhatsappIcon} className="size-7" strokeWidth={2} />
    </a>
  );
}
