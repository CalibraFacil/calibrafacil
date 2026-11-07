/**
 * The vocabulary of the calibration method model (input fields, variable bindings,
 * formulas, criteria, validations, uncertainty components, certificate content).
 * The method compiler, the API schemas and the wire contract of the frozen job
 * snapshot each describe the model with their own rules; the closed lists of
 * values live here, once, so a value added to one cannot be refused by another.
 */

/** A mass unit a mass-standard composition is expressed in. */
export const MASS_UNITS = ["mg", "g", "kg"] as const;

/** The value type of a table column of a method input. */
export const METHOD_TABLE_COLUMN_TYPES = ["text", "number"] as const;

/** What a table column is filled from, when not typed by the technician. */
export const METHOD_TABLE_COLUMN_ROLES = [
  "standard_value",
  "mass_standard_composition",
] as const;

/** Which calibration phase a table column belongs to. */
export const METHOD_COLUMN_PHASES = ["before", "after", "always"] as const;

/** Where the options of a mass-composition column come from. */
export const MASS_COMPOSITION_OPTION_SOURCES = [
  "certified_values",
  "composition_profiles",
] as const;

/** How the uncertainties of the weights of a composition combine. */
export const MASS_COMPOSITION_UNCERTAINTY_MODES = [
  "expanded_rss",
  "expanded_arithmetic",
] as const;

/** How the quantity of each weight of a composition is resolved. */
export const MASS_COMPOSITION_QUANTITY_MODES = [
  "linear_per_item_then_rss",
  "profile_linear",
] as const;

/** The kind of control a method input field is. */
export const METHOD_INPUT_FIELD_TYPES = [
  "text",
  "number",
  "select",
  "table",
] as const;

/** Whether an input is typed or read from the asset specification. */
export const METHOD_INPUT_FIELD_SOURCES = ["manual", "asset_spec"] as const;

/** The load-position layouts of the eccentricity test. */
export const ECCENTRICITY_INDICATOR_VARIANTS = [
  "circular_platform",
  "road_scale",
] as const;

/** A statistic of a table column a variable can bind to. */
export const TABLE_STATISTICS = [
  "mean",
  "sample_stddev",
  "count",
  "min",
  "max",
] as const;

/** The environmental conditions a variable can bind to. */
export const ENVIRONMENT_FIELDS = [
  "temperature",
  "humidity",
  "pressure",
] as const;

/** The properties of a standard channel a variable can bind to. */
export const STANDARD_CHANNEL_PROPERTIES = [
  "value",
  "correction",
  "uncertainty",
  "coverageFactor",
  "drift",
] as const;

/** What a formula output is in the certificate. */
export const FORMULA_REPORTING_ROLES = [
  "primary_result",
  "expanded_uncertainty",
  "coverage_factor",
  "conformity_margin",
  "conformity_verdict",
  "uncertainty_component",
  "auxiliary",
] as const;

/** The certificate group a formula output is listed in. */
export const FORMULA_REPORTING_GROUPS = [
  "calibration_result",
  "uncertainty_budget",
  "raw_calculation",
] as const;

/** How an acceptance criterion that fails is treated. */
export const ACCEPTANCE_CRITERION_SEVERITIES = [
  "info",
  "warning",
  "blocking",
] as const;

/** The comparison operators of a method validation rule. */
export const METHOD_VALIDATION_OPERATORS = [
  "<",
  "<=",
  ">",
  ">=",
  "==",
  "!=",
] as const;

/** How a method validation rule that fails is treated. */
export const METHOD_VALIDATION_SEVERITIES = ["error", "warning"] as const;

/** The distributions of a type B uncertainty component. */
export const UNCERTAINTY_DISTRIBUTIONS = [
  "normal",
  "rectangular",
  "triangular",
  "u-shaped",
] as const;

/** Whether a block of the method is printed on the certificate. */
export const CERTIFICATE_SECTION_DISPLAYS = ["full", "hidden"] as const;
