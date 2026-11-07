import {
  ENDPOINT_GROUPS,
  endpointGroupPolicies,
  endpointPolicies,
  type DataPolicy,
} from "@calibra-facil/contracts";
import type { CalibraApi } from "./types";

export type { DataPolicy };

type MethodKeys<TNamespace> = {
  [TKey in keyof TNamespace]: TNamespace[TKey] extends (
    ...args: never[]
  ) => unknown
    ? TKey
    : never;
}[keyof TNamespace] &
  string;

export type CalibraApiPolicyRegistry = {
  readonly [TNamespace in keyof CalibraApi]: {
    readonly [TMethod in MethodKeys<CalibraApi[TNamespace]>]: DataPolicy;
  };
};

export type CalibraApiNamespace = keyof CalibraApi;

export type CalibraApiMethod<TNamespace extends CalibraApiNamespace> =
  keyof (typeof calibraApiPolicyRegistry)[TNamespace] & string;

export type CalibraApiPolicyEntry = {
  namespace: CalibraApiNamespace;
  method: string;
  policy: DataPolicy;
};

/**
 * Method names of a namespace whose registry policy matches `TPolicy`.
 * Resolved from the literal policy strings in `calibraApiPolicyRegistry`, so a
 * policy reclassification changes this type — and everything derived from it —
 * in the same edit.
 */
export type CalibraApiMethodsWithPolicy<
  TNamespace extends CalibraApiNamespace,
  TPolicy extends DataPolicy,
> = {
  [TMethod in CalibraApiMethod<TNamespace>]: (typeof calibraApiPolicyRegistry)[TNamespace][TMethod] extends TPolicy
    ? TMethod
    : never;
}[CalibraApiMethod<TNamespace>];

const desktopDataPolicyUnavailableMessages = {
  "cloud-only":
    "Esta tela depende da API da nuvem e não está disponível offline. Verifique a conexão e tente novamente.",
  "cloud-first-read-fallback":
    "Dados offline ainda não estão prontos para fallback local. Esta leitura usa a nuvem primeiro e só usa o cache local depois de uma sincronização inicial.",
  "local-first-read-through-sync":
    "O cache local ainda não está pronto para esta tela. Conecte-se à internet e sincronize antes de depender do modo offline.",
  "local-command-sync":
    "Esta ação precisa ser salva no outbox local antes de sincronizar com a nuvem. Tente novamente ou verifique o status de sincronização.",
  "local-only":
    "Este recurso depende do runtime local do desktop. Reinicie o app se o serviço local não estiver disponível.",
} as const satisfies Record<DataPolicy, string>;

/**
 * Where every client method runs on desktop. Offline scope is deliberately
 * narrow (audit decision Q13) and this registry is its single source of truth:
 *
 * - field capture: an assigned job's execution from a read-only pack of method
 *   and standards (`jobs.*` reads, `saveExecution`, `submitExecution`,
 *   attachments), saved as a draft; the cloud checks the submit on sync;
 * - intake: `serviceOrders.create` and a minimal `assets.create` stub;
 * - reference reads: customers, assets, asset types, standards, methods,
 *   environmental limits and the service orders already on the device.
 *
 * Everything else (approval, certificates, signing, finance, settings, method
 * authoring, customer edits and compliance, NC/CAPA, quality, reports, portal
 * management) is `cloud-only`. The web derives which routes work offline from
 * these entries (`apps/web/src/runtime/desktop-offline-routes.ts`).
 */
export const calibraApiPolicyRegistry = {
  // Every endpoint group: the `policy` of each of its definitions.
  ...endpointGroupPolicies(ENDPOINT_GROUPS),
  jobs: {
    // `getLabelCommands` is not an endpoint of the jobs group (see `modules/jobs.ts`).
    ...endpointPolicies(ENDPOINT_GROUPS.jobs),
    getLabelCommands: "cloud-only",
  },
  sync: {
    getSession: "local-only",
    reconcile: "local-only",
    listConflicts: "local-only",
    resolveConflict: "local-only",
    listDeadEvents: "local-only",
    listBlockedEvents: "local-only",
    discardDeadEvent: "local-only",
    requeueDeadEvent: "local-only",
  },
  attachments: {
    list: "local-only",
    upload: "local-command-sync",
  },
} as const satisfies CalibraApiPolicyRegistry;

export function getCalibraApiDataPolicy<TNamespace extends CalibraApiNamespace>(
  namespace: TNamespace,
  method: CalibraApiMethod<TNamespace>,
): DataPolicy {
  for (const [candidate, policy] of Object.entries(
    calibraApiPolicyRegistry[namespace],
  )) {
    if (candidate === method) {
      return policy;
    }
  }

  throw new Error(`Unknown Calibra API data policy: ${namespace}.${method}`);
}

export function getDesktopDataPolicyUnavailableMessage(
  policy: DataPolicy,
): string {
  return desktopDataPolicyUnavailableMessages[policy];
}

export function listCalibraApiPolicyEntries(): CalibraApiPolicyEntry[] {
  return listCalibraApiNamespaces().flatMap((namespace) => {
    const methods = calibraApiPolicyRegistry[namespace];
    return Object.entries(methods).map(([method, policy]) => ({
      namespace,
      method,
      policy,
    }));
  });
}

export function listCalibraApiNamespaces(): CalibraApiNamespace[] {
  return Object.keys(calibraApiPolicyRegistry).filter(isCalibraApiNamespace);
}

/**
 * Runtime companion of `CalibraApiMethodsWithPolicy`: the method names of a
 * namespace whose registry policy is one of `policies`, typed as keys of the
 * product API namespace so composers can index `CalibraApi` with them. The
 * registry is type-total over every `CalibraApi` method, which is what makes
 * the narrowing in the filter predicate sound.
 */
export function listCalibraApiNamespaceMethodsWithPolicy<
  TNamespace extends CalibraApiNamespace,
>(
  namespace: TNamespace,
  policies: readonly DataPolicy[],
): Array<keyof CalibraApi[TNamespace] & string> {
  const registryNamespace: Record<string, DataPolicy> =
    calibraApiPolicyRegistry[namespace];

  return Object.keys(registryNamespace).filter(
    (method): method is keyof CalibraApi[TNamespace] & string => {
      const policy = registryNamespace[method];
      return policy !== undefined && policies.includes(policy);
    },
  );
}

function isCalibraApiNamespace(value: string): value is CalibraApiNamespace {
  return value in calibraApiPolicyRegistry;
}
