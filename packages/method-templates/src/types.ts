import type {
  MethodDraft,
  MethodDraftStatus,
  MethodPreviewScenario,
} from "@calibra-facil/method-definition";
import type {
  MethodCertificateContent,
  MethodFormula,
  MethodInputField,
  MethodMeasurementModel,
  MethodTypeBComponent,
  MethodValidation,
  MethodVariableBinding,
} from "@calibra-facil/schemas";

/** Stable key for a curated method template (repo source of truth). */
export type TemplateKey = "mass-balance";

/**
 * Product-format method definition (the shape persisted on a
 * `calibration_method` row). The `POST /methods/from-template` route consumes
 * this to create a DRAFT in the caller's org. `assetTypeSlug` is resolved to the
 * numeric `asset_type.id` by the route.
 */
export type TemplateProductDefinition = {
  assetTypeSlug?: string;
  name: string;
  description?: string;
  dataFields: MethodInputField[];
  variableBindings: MethodVariableBinding[];
  formulas: MethodFormula[];
  measurementModels: MethodMeasurementModel[];
  validations: MethodValidation[];
  uncertaintyParams: MethodTypeBComponent[];
  certificateContent: MethodCertificateContent | null;
  accreditedScope: boolean;
};

export type BuildDraftArgs = {
  /** The persisted method id, used to derive the draft id (fingerprint input). */
  methodId?: string | number;
  version?: number;
  status?: MethodDraftStatus;
};

/**
 * A curated, validated calibration-method template.
 *
 * `buildDraft` returns the fingerprint-bearing draft, exactly as the seed
 * compiles it (NO preview scenarios — those are kept out of the fingerprint).
 * `previewScenarios` are supplied separately to the compiler (via
 * `includePreviewScenariosInFingerprint: false`) so they validate the method
 * without perturbing its fingerprint.
 */
export type TemplateModule = {
  key: TemplateKey;
  /** Repo-owned version; bump on any metrology change. */
  templateVersion: number;
  discipline: string;
  defaultName: string;
  defaultAccreditedScope: boolean;
  /** Public guides the method is drafted from (for the certificate + review). */
  citations: readonly string[];
  buildDraft(args?: BuildDraftArgs): MethodDraft;
  /** Product-format payload for creating a DRAFT method row from this template. */
  productDefinition: TemplateProductDefinition;
  previewScenarios: readonly MethodPreviewScenario[];
};
