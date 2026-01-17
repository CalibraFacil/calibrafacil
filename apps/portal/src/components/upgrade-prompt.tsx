import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface UpgradePromptProps {
  title?: string;
  description?: string;
  features?: Array<string>;
}

/**
 * Upgrade prompt shown to portal users when accessing premium features.
 * Since portal users are customers (not lab members), they can't upgrade directly.
 * Instead, they should contact their lab.
 */
export function UpgradePrompt({
  title = "Recurso Premium",
  description = "Este recurso requer um plano superior.",
  features = [],
}: UpgradePromptProps) {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/20">
            <svg
              className="h-4 w-4 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <CardTitle className="text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{description}</p>

        {features.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Inclui:</p>
            <ul className="text-sm space-y-1">
              {features.map((feature, index) => (
                <li key={index} className="flex items-center gap-2">
                  <svg
                    className="h-3 w-3 text-green-500"
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
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs text-muted-foreground pt-2">
          Entre em contato com o laboratório para solicitar acesso.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Inline upgrade prompt for smaller spaces.
 */
export function UpgradePromptInline({
  message = "Recurso disponivel em planos superiores",
}: {
  message?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 text-sm">
      <svg
        className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0"
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
      <span className="text-amber-800 dark:text-amber-200">{message}</span>
    </div>
  );
}
