import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface FeatureGateProps {
  feature: string;
  isEnabled: boolean;
  children: ReactNode;
  labName?: string;
}

/**
 * Feature gate component that shows upgrade prompt when feature is not available.
 * Used in portal to gate access to premium features based on lab's subscription.
 */
export function FeatureGate({
  feature,
  isEnabled,
  children,
  labName,
}: FeatureGateProps) {
  if (isEnabled) {
    return <>{children}</>;
  }

  return (
    <div className="flex items-center justify-center min-h-100 p-6">
      <Card className="max-w-md w-full text-center">
        <CardHeader>
          <CardTitle>Recurso não disponível</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            O recurso "{getFeatureLabel(feature)}" não está disponível no plano
            atual{labName ? ` do laboratorio ${labName}` : ""}.
          </p>
          <p className="text-sm text-muted-foreground">
            Entre em contato com o laboratório para solicitar acesso a este
            recurso.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Simpler version that just hides content when feature is not available.
 */
export function FeatureHidden({
  isEnabled,
  children,
}: {
  isEnabled: boolean;
  children: ReactNode;
}) {
  if (!isEnabled) {
    return null;
  }
  return <>{children}</>;
}

/**
 * Badge component to show feature availability status.
 */
export function FeatureBadge({
  feature,
  isEnabled,
}: {
  feature: string;
  isEnabled: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${
        isEnabled
          ? "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
      }`}
    >
      {isEnabled ? (
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      )}
      {getFeatureLabel(feature)}
    </span>
  );
}

function getFeatureLabel(feature: string): string {
  const labels: Record<string, string> = {
    math_engine: "Calculo de incerteza",
    portal: "Portal do cliente",
    financial: "Modulo financeiro",
    api: "Acesso API",
    custom_domain: "Dominio personalizado",
  };
  return labels[feature] || feature;
}
