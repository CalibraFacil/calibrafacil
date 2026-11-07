import type {
  CustomerDetail,
  CustomerRecord,
  CustomersListResponse,
} from "./customers";

/**
 * Contract-valid example payloads for the customers endpoints, for tests in any
 * package. Every value mirrors what the handlers return today;
 * `customers.test.ts` parses every builder against its response schema.
 */

export function buildCustomerRecord(
  overrides: Partial<CustomerRecord> = {},
): CustomerRecord {
  return {
    id: 1,
    name: "Metalúrgica Alfa Ltda",
    tradeName: "Alfa",
    taxId: "12.345.678/0001-90",
    email: "contato@alfa.example.test",
    phone: "11 4000-0000",
    address: { city: "São Paulo", state: "SP" },
    authOrganizationId: "org-client-1",
    groupId: null,
    groupName: null,
    compliance: { qualificationStatus: "qualified" },
    createdAt: "2026-01-10T12:00:00.000Z",
    updatedAt: "2026-01-10T12:00:00.000Z",
    ...overrides,
  };
}

export function buildCustomersListResponse(
  data: CustomerRecord[] = [buildCustomerRecord()],
): CustomersListResponse {
  return {
    data,
    pagination: {
      page: 1,
      limit: 20,
      total: data.length,
      totalPages: data.length === 0 ? 0 : 1,
    },
  };
}

export function buildCustomerDetail(
  overrides: Partial<CustomerDetail> = {},
): CustomerDetail {
  return {
    ...buildCustomerRecord(),
    financialSummary: {
      openDocumentsCount: 0,
      overdueDocumentsCount: 0,
      openBalanceCents: 0,
      overdueBalanceCents: 0,
      overdueBalanceFlag: false,
    },
    activeCommercialAgreement: null,
    group: null,
    ...overrides,
  };
}
