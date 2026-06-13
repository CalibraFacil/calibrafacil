import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Calendar03Icon,
  MailAtSign01Icon,
  SquareLock01Icon,
} from "@hugeicons/core-free-icons";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings/notifications")({
  component: NotificationsPage,
});

type DigestFrequency = "NONE" | "DAILY" | "WEEKLY";

type DigestPreferences = {
  digestFrequency: DigestFrequency;
};

const OPTIONS: Array<{
  value: DigestFrequency;
  label: string;
  description: string;
  icon: typeof MailAtSign01Icon;
}> = [
  {
    value: "NONE",
    label: "Desativado",
    description: "Nenhum resumo por e-mail.",
    icon: SquareLock01Icon,
  },
  {
    value: "DAILY",
    label: "Diário",
    description: "Todos os dias pela manhã.",
    icon: MailAtSign01Icon,
  },
  {
    value: "WEEKLY",
    label: "Semanal",
    description: "Às segundas-feiras.",
    icon: Calendar03Icon,
  },
];

async function fetchPreferences(): Promise<DigestPreferences> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/portal/notification-preferences`,
    { credentials: "include" },
  );
  if (!response.ok) {
    throw new Error("Falha ao carregar preferências");
  }
  return response.json();
}

async function savePreferences(
  digestFrequency: DigestFrequency,
): Promise<DigestPreferences> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/portal/notification-preferences`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digestFrequency }),
    },
  );
  if (!response.ok) {
    throw new Error("Falha ao salvar preferências");
  }
  return response.json();
}

function NotificationsPage() {
  const queryClient = useQueryClient();

  const preferencesQuery = useQuery({
    queryKey: ["portal-notification-preferences"],
    queryFn: fetchPreferences,
  });

  const mutation = useMutation({
    mutationFn: savePreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(["portal-notification-preferences"], data);
    },
  });

  const current =
    mutation.variables && mutation.isPending
      ? mutation.variables
      : (preferencesQuery.data?.digestFrequency ?? "NONE");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Notificações por e-mail</CardTitle>
          <CardDescription>
            Receba um resumo dos instrumentos com calibração vencida ou a
            vencer nos próximos 30 dias.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {preferencesQuery.error ? (
            <p className="text-destructive text-sm">
              Erro ao carregar suas preferências. Recarregue a página.
            </p>
          ) : (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Resumo de calibrações</h3>
              <p className="text-muted-foreground text-sm">
                Escolha com que frequência deseja receber o resumo.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                {OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    variant={current === option.value ? "default" : "outline"}
                    onClick={() => mutation.mutate(option.value)}
                    disabled={preferencesQuery.isLoading || mutation.isPending}
                    className="flex items-center gap-2"
                  >
                    {mutation.isPending &&
                    mutation.variables === option.value ? (
                      <Spinner className="size-4" />
                    ) : (
                      <HugeiconsIcon icon={option.icon} className="size-4" />
                    )}
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground pt-1 text-xs">
                {OPTIONS.find((option) => option.value === current)
                  ?.description ?? ""}
                {mutation.error
                  ? " Não foi possível salvar — tente novamente."
                  : ""}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
