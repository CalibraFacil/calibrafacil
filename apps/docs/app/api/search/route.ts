import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

// Exported once at build time as a static index (output: "export"); the
// browser downloads it and searches locally (components/search-dialog.tsx).
export const revalidate = false;

export const { staticGET: GET } = createFromSource(source, {
  language: "portuguese",
});
