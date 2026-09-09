"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Carries the plan a visitor clicked in the pricing table down to the lead
 * form on the same page, so the form arrives with "Plano de interesse" already
 * answered and sales knows the ticket before the first call. Plain context
 * instead of a query param: both sections are already client components and a
 * round trip would reload the page mid-scroll.
 */
type PlanIntent = {
  plan: string;
  setPlan: (plan: string) => void;
};

const PlanIntentContext = createContext<PlanIntent | null>(null);

export function PlanIntentProvider({ children }: { children: ReactNode }) {
  const [plan, setPlanState] = useState("");
  const setPlan = useCallback((next: string) => setPlanState(next), []);
  const value = useMemo(() => ({ plan, setPlan }), [plan, setPlan]);

  return (
    <PlanIntentContext.Provider value={value}>
      {children}
    </PlanIntentContext.Provider>
  );
}

/** Returns a no-op outside the provider so either section can render alone. */
export function usePlanIntent(): PlanIntent {
  const context = useContext(PlanIntentContext);
  return context ?? { plan: "", setPlan: () => {} };
}
