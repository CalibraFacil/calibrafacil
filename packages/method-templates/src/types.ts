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

/**
 * Stable key for a curated PLATFORM method template (repo source of truth).
 * Lab-specific methods (e.g. the example `mass-balance`) are NOT catalog
 * templates — they are not in the registry.
 */
export type TemplateKey =
  | "force-indication"
  | "frequency-indication"
  | "electrical-indication"
  | "volume-glassware"
  | "humidity-magnus"
  | "weighing-instrument";

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

/**
 * Severity of a `[VERIFICAR]` item surfaced to the adopting lab.
 *  - `info`     — informational caveat the lab should be aware of.
 *  - `action`   — the lab MUST act/verify before use (e.g. enter a real value,
 *                 read the actual coverage factor from a certificate).
 *  - `platform` — an engine/code-level risk OUTSIDE the lab's control (tracked
 *                 by the platform); NOT something a lab can "verify away" with a
 *                 checkbox.
 */
export type VerificarSeverity = "info" | "action" | "platform";

/**
 * Surfaceable metrology context for a template — promoted out of the source
 * docblock into structured data so the `from-template` catalog/picker can render
 * the cited sources, the measurement model, conformance notes, the open
 * `[VERIFICAR]` items and the explicitly omitted uncertainty components. This is
 * the "informed, not trust-me" surface a lab reviews before adopting.
 *
 * Authored as a FAITHFUL transcription of the template's cited docblock — never
 * invented. The registry oracle enforces structural integrity: the disclosed
 * `verificarItems` may not understate the literal `[VERIFICAR]` markers in the
 * compiled definition, every `fieldKeys` entry must resolve to a real input /
 * uncertainty key, `workedExample.scenarioKey` must exist in `previewScenarios`,
 * and a `cited_guide_table` worked example must match its shipped scenario.
 */
export type MetrologyGovernance = {
  /** Expert one-liner, beyond `productDefinition.description`. */
  summary: string;
  /** The measurand / model in plain terms, e.g. "E = I − m_ref". */
  measurand: string;
  /** Whether the result comes from explicit formulas or a GUM measurementModel. */
  model: "formulas" | "gum_measurement_model";
  /** Cited source guides (edition kept discrete; section + working URL). */
  sources: ReadonlyArray<{
    title: string;
    edition: string;
    section?: string;
    url?: string;
  }>;
  /** Conformance notes tying the method to specific guide clauses. */
  conformanceNotes: ReadonlyArray<{ ref: string; note: string }>;
  /** Open decisions the lab must review before use (verbatim from the docblock). */
  verificarItems: ReadonlyArray<{
    ref?: string;
    item: string;
    severity: VerificarSeverity;
    /** input/uncertainty keys this item refers to (oracle-checked to resolve). */
    fieldKeys?: readonly string[];
  }>;
  /** Uncertainty components deliberately NOT modelled (the lab's responsibility). */
  omittedComponents: ReadonlyArray<{
    ref: string;
    component: string;
    appliesWhen?: string;
  }>;
  /**
   * A worked example for the picker. Only `cited_guide_table` may claim it
   * reproduces a published guide value; `engine_characterization` is an internal
   * engine check carrying no external-conformance claim.
   */
  workedExample?: {
    scenarioKey: string;
    provenance: "cited_guide_table" | "engine_characterization";
    source: string;
    expected: Record<string, number>;
  };
  /**
   * This picker only ever creates a DRAFT — a "validated" status is never
   * surfaced here (encoded as a literal so it is a type-level guarantee).
   */
  reviewStatus: "draft_pending_revalidation";
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
  /**
   * Surfaceable metrology context for the from-template picker (sources, model,
   * conformance, `[VERIFICAR]` items, omitted components, worked example).
   * Optional so a template can exist before its governance is authored — but the
   * catalog endpoint only serves templates whose governance is complete.
   */
  governance?: MetrologyGovernance;
};
