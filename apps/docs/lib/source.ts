import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

// Served under /docs via next.config `basePath` — Next prefixes every <Link>
// automatically, so page.url (and thus the sitemap join) stays un-prefixed here.
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});
