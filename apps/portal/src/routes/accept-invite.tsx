import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { portalAuthClient, usePortalSession } from "@calibra-facil/auth/client";
import { translateAuthErrorMessage } from "@calibra-facil/auth/error-messages";
import { z } from "zod";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { getApiBaseUrl } from "@/lib/utils";

const searchSchema = z.object({
  token: z.string().optional(),
});

export const Route = createFileRoute("/accept-invite")({
  validateSearch: searchSchema,
  component: AcceptInvitePage,
});

type InvitationData = {
  id: string;
  email: string;
  organizationName: string;
  organizationSlug: string;
  inviterEmail: string;
  status: string;
  expiresAt: Date;
};

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const { data: session, isPending: sessionLoading } = usePortalSession();

  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const invitationQuery = useQuery({
    queryKey: ["portal-invitation", token],
    queryFn: async (): Promise<InvitationData> => {
      if (!token) {
        throw new Error("Token de convite não fornecido.");
      }

      const response = await fetch(
        `${getApiBaseUrl()}/api/invitations/${token}`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Convite não encontrado.");
        }
        throw new Error("Convite inválido ou expirado.");
      }

      const data = await response.json();
      return {
        id: data.id,
        email: data.email,
        organizationName: data.organizationName,
        organizationSlug: data.organizationSlug,
        inviterEmail: data.inviterEmail || "",
        status: data.status,
        expiresAt: new Date(data.expiresAt),
      };
    },
  });
  const invitation = invitationQuery.data;
  const error =
    invitationQuery.error instanceof Error
      ? invitationQuery.error.message
      : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!invitation || !token) return;

    setSubmitting(true);

    try {
      const callbackURL =
        typeof window !== "undefined"
          ? new URL(
              `/accept-invite?token=${token}`,
              window.location.origin,
            ).toString()
          : `/accept-invite?token=${token}`;
      const result = await portalAuthClient.signIn.magicLink({
        email: invitation.email,
        callbackURL,
        newUserCallbackURL: callbackURL,
        errorCallbackURL:
          typeof window !== "undefined"
            ? `${window.location.origin}/sign-in?error=magic-link`
            : undefined,
      });

      if (result.error) {
        toast.error(
          translateAuthErrorMessage(
            result.error.message,
            "Erro ao enviar link de acesso",
          ),
        );
        setSubmitting(false);
        return;
      }

      setLinkSent(true);
      toast.success("Link de acesso enviado");
    } catch {
      toast.error("Erro ao enviar link de acesso");
    } finally {
      setSubmitting(false);
    }
  };

  if (invitationQuery.isPending || sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl text-destructive">Erro</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Convite não encontrado</CardTitle>
            <CardDescription>
              O convite que você está tentando acessar não existe ou expirou.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (invitation.status !== "pending") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Convite já utilizado</CardTitle>
            <CardDescription>
              Este convite já foi aceito ou cancelado.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (new Date() > invitation.expiresAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Convite expirado</CardTitle>
            <CardDescription>
              Este convite expirou. Solicite um novo convite ao laboratório.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // If user is logged in with matching email, show accepting state
  if (session) {
    if (
      session.user.email.trim().toLowerCase() !==
      invitation.email.trim().toLowerCase()
    ) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-4">
          <Card className="w-full max-w-md">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl text-destructive">Erro</CardTitle>
              <CardDescription>
                {`Este convite foi enviado para ${invitation.email}. Você está logado como ${session.user.email}.`}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }

    return <LoggedInInviteAcceptance invitation={invitation} />;
  }

  // New users receive a magic link, then return here authenticated.
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Acessar convite</CardTitle>
          <CardDescription>
            Você foi convidado para acessar{" "}
            <strong>{invitation.organizationName}</strong> no CalibraFácil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={invitation.email}
                disabled
                className="bg-muted"
              />
            </div>

            {linkSent ? (
              <div className="bg-primary/10 text-primary rounded-md p-4 text-sm">
                Enviamos um link seguro para este email. Abra o link para
                finalizar o convite.
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full active:scale-[0.96] transition-transform"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Spinner className="mr-2" />
                  Enviando link...
                </>
              ) : (
                "Receber link de acesso"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function LoggedInInviteAcceptance({
  invitation,
}: {
  invitation: InvitationData;
}) {
  const organizationsQuery = useQuery({
    queryKey: [
      "portal-organizations",
      "accept-invite",
      invitation.organizationSlug,
    ],
    queryFn: async () => {
      const orgsResult = await portalAuthClient.organization.list();
      return orgsResult.data ?? [];
    },
  });

  if (organizationsQuery.isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Verificando convite...</CardTitle>
            <CardDescription>
              Aguarde enquanto validamos seu acesso.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Spinner className="size-8" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const isMember = (organizationsQuery.data ?? []).some(
    (org) => org.slug === invitation.organizationSlug,
  );

  if (isMember) {
    return <InviteMemberRedirectOnMount />;
  }

  return <InviteAutoAcceptOnMount invitation={invitation} />;
}

function InviteMemberRedirectOnMount() {
  const navigate = useNavigate();

  useMountEffect(() => {
    toast.success("Você já é membro desta organização!");
    navigate({ to: "/" });
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Redirecionando...</CardTitle>
          <CardDescription>
            Você já faz parte desta organização.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function InviteAutoAcceptOnMount({
  invitation,
}: {
  invitation: InvitationData;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useMountEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await portalAuthClient.organization.acceptInvitation({
        invitationId: invitation.id,
      });

      if (cancelled) return;

      if (result.error) {
        if (
          result.error.message?.includes("already") ||
          result.error.code === "ALREADY_MEMBER" ||
          result.error.code === "INVITATION_NOT_FOUND"
        ) {
          toast.success("Você já é membro desta organização!");
          navigate({ to: "/" });
          return;
        }

        const message = translateAuthErrorMessage(
          result.error.message,
          "Erro ao aceitar convite",
        );
        setError(message);
        toast.error(message);
        return;
      }

      toast.success("Convite aceito com sucesso!");
      navigate({ to: "/" });
    })();

    return () => {
      cancelled = true;
    };
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            {error ? "Erro" : "Aceitando convite..."}
          </CardTitle>
          <CardDescription>
            {error ?? "Por favor, aguarde enquanto processamos seu convite."}
          </CardDescription>
        </CardHeader>
        {!error ? (
          <CardContent className="flex justify-center">
            <Spinner className="size-8" />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
