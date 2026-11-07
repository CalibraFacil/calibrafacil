import { describe, expect, it } from "vitest";

import { competenceEndpoints } from "./competences";
import {
  buildCompetenceListItem,
  buildCompetencesListResponse,
  buildCompetencesMatrixResponse,
} from "./competences.fixtures";

describe("competence endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    expect(
      competenceEndpoints.list.response.safeParse(
        buildCompetencesListResponse([
          buildCompetenceListItem(),
          buildCompetenceListItem({
            id: 2,
            assetTypeId: null,
            assetTypeName: null,
          }),
        ]),
      ).success,
    ).toBe(true);
    expect(
      competenceEndpoints.matrix.response.safeParse(
        buildCompetencesMatrixResponse(),
      ).success,
    ).toBe(true);
  });
});
