import { z } from "zod";

import { endpoint, routeId, type EndpointGroup } from "./define";

/**
 * The short label of a record (an NC number, a CAPA number, a competence's
 * person), used by breadcrumbs and links. The label routes live in the NC,
 * CAPA and competences routers; the response schemas are wire schemas written
 * from what their handlers return. `cloud-only`: the desktop answers every
 * label with null.
 */

const labelSchema = z.object({ id: z.number(), label: z.string() });
const idParams = z.object({ id: routeId });

const DESKTOP_LABEL = "Rótulos de registros";

export const entityLabelEndpoints = {
  getNonConformance: endpoint({
    method: "get",
    path: "/api/nc/:id/label",
    params: idParams,
    response: labelSchema,
    failure: "Falha ao carregar o rótulo da não conformidade",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getCapa: endpoint({
    method: "get",
    path: "/api/capa/:id/label",
    params: idParams,
    response: labelSchema,
    failure: "Falha ao carregar o rótulo da ação corretiva",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
  getCompetence: endpoint({
    method: "get",
    path: "/api/competences/:id/label",
    params: idParams,
    response: labelSchema,
    failure: "Falha ao carregar o rótulo da competência",
    policy: "cloud-only",
    desktopLabel: DESKTOP_LABEL,
  }),
} as const satisfies EndpointGroup;
