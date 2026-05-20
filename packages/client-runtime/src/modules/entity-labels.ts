import type { EntityLabelsApi } from "../types";

export function createEntityLabelsApi(rawCloudClient: any): EntityLabelsApi {
  return {
    async getNonConformance(id) {
      return parseCloudEntityLabel(
        await rawCloudClient.api.nc[":id"].label.$get({
          param: { id: String(id) },
        }),
        "non-conformance",
      );
    },
    async getCapa(id) {
      return parseCloudEntityLabel(
        await rawCloudClient.api.capa[":id"].label.$get({
          param: { id: String(id) },
        }),
        "capa",
      );
    },
    async getCompetence(id) {
      return parseCloudEntityLabel(
        await rawCloudClient.api.competences[":id"].label.$get({
          param: { id: String(id) },
        }),
        "competence",
      );
    },
  };
}

async function parseCloudEntityLabel(
  response: Response,
  entityName: string,
): Promise<string | null> {
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch ${entityName} label`);
  }

  const data = (await response.json()) as { label?: string | null };
  return data.label ?? null;
}
