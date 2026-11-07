import { describe, expect, it } from "vitest";
import {
  ASSET_STATUS,
  CALIBRATION_REQUEST_STATUS,
  COMPETENCE_STATUS,
  CORRECTIVE_ACTION_STATUS,
  INVITATION_STATUS,
  METHOD_STATUS,
  NON_CONFORMANCE_STATUS,
  OOT_NOTIFICATION_STATUS,
  OPEN_CALIBRATION_REQUEST_STATUSES,
  PT_OVERALL_STATUS,
  REFERENCE_STANDARD_STATUS,
  SPC_STATUS,
  TRAINING_STATUS,
  VISIT_STATUS,
} from "./index";

describe("status vocabularies", () => {
  it("label a state the same way on every screen", () => {
    expect(ASSET_STATUS.label("MAINTENANCE")).toBe("Em manutenção");
    expect(REFERENCE_STANDARD_STATUS.label("OUT_OF_TOLERANCE")).toBe(
      "Fora de tolerância",
    );
    expect(CALIBRATION_REQUEST_STATUS.label("REJECTED")).toBe("Recusada");
    expect(VISIT_STATUS.label("IN_PROGRESS")).toBe("Em andamento");
    expect(METHOD_STATUS.label("PENDING_APPROVAL")).toBe("Em aprovação");
    expect(NON_CONFORMANCE_STATUS.label("under_review")).toBe("Em análise");
    expect(CORRECTIVE_ACTION_STATUS.label("INVESTIGATION")).toBe(
      "Em investigação",
    );
    expect(OOT_NOTIFICATION_STATUS.label("GENERATED")).toBe("Gerada");
    expect(COMPETENCE_STATUS.label("TRAINING_ASSIGNED")).toBe(
      "Treinamento atribuído",
    );
    expect(TRAINING_STATUS.label("in_progress")).toBe("Em andamento");
    expect(PT_OVERALL_STATUS.label("unsatisfactory")).toBe("Insatisfatório");
    expect(SPC_STATUS.label("out_of_control")).toBe("Fora de controle");
    expect(INVITATION_STATUS.label("expired")).toBe("Expirado");
  });

  it("tone a state by what it means", () => {
    expect(ASSET_STATUS.tone("SCRAPPED")).toBe("critical");
    expect(VISIT_STATUS.tone("COMPLETED")).toBe("ok");
    expect(NON_CONFORMANCE_STATUS.tone("open")).toBe("critical");
    expect(PT_OVERALL_STATUS.tone("pending")).toBe("neutral");
    expect(COMPETENCE_STATUS.tone("PENDING_EVALUATION")).toBe("warning");
  });

  it("parse a raw value into a state, or null", () => {
    expect(ASSET_STATUS.parse("ACTIVE")).toBe("ACTIVE");
    expect(ASSET_STATUS.parse("active")).toBeNull();
    expect(METHOD_STATUS.parse(undefined)).toBeNull();
  });

  it("name the subsets the code uses", () => {
    expect(OPEN_CALIBRATION_REQUEST_STATUSES).toEqual([
      "PENDING",
      "UNDER_REVIEW",
    ]);
  });
});
