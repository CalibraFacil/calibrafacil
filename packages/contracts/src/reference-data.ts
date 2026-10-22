import { z } from "zod";
import {
  AssetStatusSchema,
  MeasurementUnitSchema,
  MetrologyRegimeSchema,
} from "@calibra-facil/schemas";

import { nullableNumber, nullableString, paginationSchema } from "./common";

/**
 * Response contracts for the reference data a technician reads and captures in
 * the field: customers, assets, asset types and calibration methods. Wire
 * schemas (see `jobs.ts` for the rules). The cloud API and the desktop
 * local-server (offline mirror) both serve these shapes; the API contract
 * specs and the local-server contract tests parse the real responses with the
 * same schemas, so the two cannot drift apart unnoticed.
 *
 * Fields the offline mirror does not keep (the SQLite cache stores only what
 * the field workflows need) are declared optional here, exactly as the client
 * types already treat them.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

const customerComplianceSchema = z.object({
  qualificationStatus: z
    .enum(["pending", "qualified", "suspended", "expired"])
    .optional(),
});

/** One customer row as GET /api/customers lists it. */
export const customerSchema = z.object({
  id: z.number(),
  name: z.string(),
  tradeName: nullableString.optional(),
  taxId: nullableString,
  email: nullableString,
  phone: nullableString,
  address: jsonRecordSchema.nullable(),
  /** The CLIENT organization behind the portal; the offline mirror has none. */
  authOrganizationId: nullableString,
  groupId: nullableNumber.optional(),
  groupName: nullableString.optional(),
  compliance: customerComplianceSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Customer = z.infer<typeof customerSchema>;

/** GET /api/customers */
export const customersListResponseSchema = z.object({
  data: z.array(customerSchema),
  pagination: paginationSchema,
});
export type CustomersListResponse = z.infer<typeof customersListResponseSchema>;

/** GET /api/customers/:id: the row plus its financial standing. */
export const customerDetailSchema = customerSchema.extend({
  financialSummary: z.object({
    openDocumentsCount: z.number(),
    overdueDocumentsCount: z.number(),
    openBalanceCents: z.number(),
    overdueBalanceCents: z.number(),
    overdueBalanceFlag: z.boolean(),
  }),
  group: z.object({ id: z.number(), name: z.string() }).nullable().optional(),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

// ---------------------------------------------------------------------------
// Asset types
// ---------------------------------------------------------------------------

export const assetTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: nullableString,
  /** The field definitions of the specification form (opaque list of records). */
  definition: z.array(jsonRecordSchema).nullable(),
});
export type AssetTypeItem = z.infer<typeof assetTypeSchema>;

/** GET /api/asset-types */
export const assetTypesResponseSchema = z.object({
  data: z.array(assetTypeSchema),
});
export type AssetTypesResponse = z.infer<typeof assetTypesResponseSchema>;

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/** The stored asset: what POST /api/assets (201) answers with. */
export const assetRecordSchema = z.object({
  id: z.number(),
  customerId: z.number(),
  assetTypeId: z.number(),
  name: z.string(),
  manufacturer: nullableString,
  model: nullableString,
  serialNumber: z.string(),
  tag: z.string(),
  status: AssetStatusSchema,
  baseMeasurementUnit: MeasurementUnitSchema.nullable(),
  specifications: jsonRecordSchema.nullable(),
  lastCalibrationDate: nullableString,
  nextCalibrationDate: nullableString,
  comments: nullableString,
  metrologyRegime: MetrologyRegimeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetRecord = z.infer<typeof assetRecordSchema>;

/** An asset with its customer and type joined in, as the list and the detail show it. */
export const assetSchema = assetRecordSchema.extend({
  customerName: z.string(),
  customerTaxId: nullableString,
  assetTypeName: z.string(),
  assetTypeSlug: nullableString,
  assetTypeDefinition: z.array(jsonRecordSchema).nullable(),
});
export type Asset = z.infer<typeof assetSchema>;

/** GET /api/assets */
export const assetsListResponseSchema = z.object({
  data: z.array(assetSchema),
  pagination: paginationSchema,
});
export type AssetsListResponse = z.infer<typeof assetsListResponseSchema>;

/** GET /api/assets/:id */
export const assetDetailSchema = assetSchema.extend({
  installedAt: nullableString,
  /** The regulation-fixed verification periodicity (legal metrology), opaque here. */
  regulatedInterval: jsonRecordSchema.nullable(),
  nextLegalVerificationDate: nullableString,
});
export type AssetDetail = z.infer<typeof assetDetailSchema>;

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** One method as GET /api/methods lists it (the compiled artifact stays out). */
export const methodSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: nullableString,
  version: z.number(),
  status: z.string(),
  assetTypeId: nullableNumber,
  assetTypeName: nullableString,
  dataFields: z.array(z.unknown()),
  variableBindings: z.array(z.unknown()),
  formulas: z.array(z.unknown()),
  measurementModels: z.array(z.unknown()),
  validations: z.array(z.unknown()),
  certificateContent: z.unknown().optional(),
  accreditedScope: z.boolean().optional(),
  methodFingerprint: nullableString.optional(),
  /** `{ version, optionsFingerprint }` of the engine that compiled it; the column is untyped. */
  methodEngine: z.unknown(),
  methodCompiledAt: nullableString.optional(),
  createdAt: z.string(),
  publishedAt: nullableString,
  parentId: nullableNumber,
});
export type Method = z.infer<typeof methodSchema>;

/** GET /api/methods */
export const methodsListResponseSchema = z.object({
  data: z.array(methodSchema),
  pagination: paginationSchema,
});
export type MethodsListResponse = z.infer<typeof methodsListResponseSchema>;

/** GET /api/methods/:id: adds the compiled artifact and the review trail. */
export const methodDetailSchema = methodSchema.extend({
  uncertaintyParams: z.array(z.unknown()),
  compiledMethod: z.unknown(),
  publicationEvidence: z.unknown(),
});
export type MethodDetail = z.infer<typeof methodDetailSchema>;
