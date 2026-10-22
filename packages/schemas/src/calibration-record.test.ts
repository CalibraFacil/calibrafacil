import { describe, expect, it } from "vitest";

import {
  DESKTOP_EXECUTION_PAYLOAD_VERSION,
  desktopEventCarriesCalibrationRecordRule,
  validateCalibrationLocationForSubmit,
  validateCalibrationPhasesForSubmit,
  validateCalibrationRecordForSubmit,
} from "./index";

const LOCATION = {
  type: "customer_site",
  addressText: "Rua de Teste, 123",
  recordedAt: "2026-03-20T15:00:00.000Z",
  recordedBy: "user-1",
};

// The one rule a submit applies to the calibration location and the phase
// justifications. The cloud command, the desktop's local database and the local
// server all call it (REQ-P112-1), so the messages are the cloud's.
describe("validateCalibrationLocationForSubmit", () => {
  it("REQ-P112-1: refuses a missing location", () => {
    expect(validateCalibrationLocationForSubmit(null)).toBe(
      "Local da calibração é obrigatório",
    );
    expect(validateCalibrationLocationForSubmit(undefined)).toBe(
      "Local da calibração é obrigatório",
    );
  });

  it("REQ-P112-1: refuses an unknown location type", () => {
    expect(
      validateCalibrationLocationForSubmit({ ...LOCATION, type: "moon" }),
    ).toBe("Tipo de local da calibração é inválido");
  });

  it("REQ-P112-1: refuses an empty or blank address", () => {
    expect(
      validateCalibrationLocationForSubmit({ ...LOCATION, addressText: "" }),
    ).toBe("Endereço/local da calibração é obrigatório");
    expect(
      validateCalibrationLocationForSubmit({ ...LOCATION, addressText: "  " }),
    ).toBe("Endereço/local da calibração é obrigatório");
    expect(
      validateCalibrationLocationForSubmit({ type: "lab", addressText: 3 }),
    ).toBe("Endereço/local da calibração é obrigatório");
  });

  it("REQ-P112-1: accepts each location type with an address", () => {
    for (const type of ["customer_site", "lab", "other"]) {
      expect(
        validateCalibrationLocationForSubmit({ ...LOCATION, type }),
      ).toBeNull();
    }
  });
});

describe("validateCalibrationPhasesForSubmit", () => {
  it("REQ-P112-1: a block that was not performed needs a written reason", () => {
    const snapshot = {
      blocks: {
        ensaio_a: { mode: "before_and_after" },
        ensaio_b: { mode: "not_performed" },
      },
    };
    expect(validateCalibrationPhasesForSubmit(snapshot)).toBe(
      "Informe o motivo para não executar o bloco ensaio_b",
    );
    expect(
      validateCalibrationPhasesForSubmit({
        blocks: { ensaio_b: { mode: "not_performed", reason: "   " } },
      }),
    ).toBe("Informe o motivo para não executar o bloco ensaio_b");
  });

  it("REQ-P112-1: accepts a justified block, and no phases at all", () => {
    expect(
      validateCalibrationPhasesForSubmit({
        blocks: { ensaio_b: { mode: "not_performed", reason: "Sem acesso" } },
      }),
    ).toBeNull();
    expect(validateCalibrationPhasesForSubmit(null)).toBeNull();
    expect(validateCalibrationPhasesForSubmit({ blocks: {} })).toBeNull();
  });
});

describe("validateCalibrationRecordForSubmit", () => {
  it("REQ-P112-1: reports the location first, then the phases", () => {
    const phases = { blocks: { a: { mode: "not_performed" } } };
    expect(validateCalibrationRecordForSubmit({ location: null, phases })).toBe(
      "Local da calibração é obrigatório",
    );
    expect(
      validateCalibrationRecordForSubmit({ location: LOCATION, phases }),
    ).toBe("Informe o motivo para não executar o bloco a");
    expect(
      validateCalibrationRecordForSubmit({
        location: LOCATION,
        phases: null,
      }),
    ).toBeNull();
  });
});

// REQ-P112-3: how the cloud tells an event from a desktop build that predates
// the rule (exempt, so it is not dead-lettered on upgrade) from one that
// enforced it offline (checked again here).
describe("desktopEventCarriesCalibrationRecordRule", () => {
  it("REQ-P112-3: an event without the payload version is a legacy event", () => {
    expect(desktopEventCarriesCalibrationRecordRule({})).toBe(false);
    // The old builds always wrote the key, null when nothing was recorded: the
    // key says nothing about whether the build enforced the rule.
    expect(
      desktopEventCarriesCalibrationRecordRule({
        calibrationLocationSnapshot: null,
      }),
    ).toBe(false);
    expect(
      desktopEventCarriesCalibrationRecordRule({
        executionPayloadVersion: "2",
      }),
    ).toBe(false);
    expect(
      desktopEventCarriesCalibrationRecordRule({ executionPayloadVersion: 1 }),
    ).toBe(false);
  });

  it("REQ-P112-3: an event stamped with the current version is enforced", () => {
    expect(
      desktopEventCarriesCalibrationRecordRule({
        executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION,
      }),
    ).toBe(true);
    expect(
      desktopEventCarriesCalibrationRecordRule({
        executionPayloadVersion: DESKTOP_EXECUTION_PAYLOAD_VERSION + 1,
      }),
    ).toBe(true);
  });
});
