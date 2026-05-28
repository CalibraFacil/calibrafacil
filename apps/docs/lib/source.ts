import { docs } from "@/.source";
import { loader } from "fumadocs-core/source";

// Docs are mounted at the root of docs.calibrafacil.com — there is no /docs prefix.
export const source = loader({
  baseUrl: "/",
  source: docs.toFumadocsSource(),
});
