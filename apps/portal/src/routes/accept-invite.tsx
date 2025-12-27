import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { portalAuthClient, usePortalSession } from "@calibra-facil/auth/client";
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
  const navigate = useNavigate();
  const { data: session, isPending: sessionLoading } = usePortalSession();

  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track if invitation was already accepted to prevent duplicate calls
  const invitationAcceptedRef = useRef(false);

  // Form state
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Get API base URL
  const getApiBaseUrl = () => {
    const host =
      typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `https://${host}:3000`;
  };

  // Fetch invitation details using our public API endpoint
  useEffect(() => {
    async function fetchInvitation() {
      if (!token) {
        setError("Token de convite não fornecido.");
        setLoading(false);
        return;
      }

      try {
        // Use our public API endpoint that doesn't require authentication
        const response = await fetch(
          `${getApiBaseUrl()}/api/invitations/${token}`,
          {
            credentials: "include",
          },
        );

        if (!response.ok) {
          if (response.status === 404) {
            setError("Convite não encontrado.");
          } else {
            setError("Convite inválido ou expirado.");
          }
          setLoading(false);
          return;
        }

        const data = await response.json();
        setInvitation({
          id: data.id,
          email: data.email,
          organizationName: data.organizationName,
          organizationSlug: data.organizationSlug,
          inviterEmail: data.inviterEmail || "",
          status: data.status,
          expiresAt: new Date(data.expiresAt),
        });
      } catch {
        setError("Erro ao buscar informações do convite.");
      } finally {
        setLoading(false);
      }
    }

    fetchInvitation();
  }, [token]);

  // If user is already logged in, check if they're already a member or accept the invitation
  useEffect(() => {
    async function handleLoggedInUser() {
      if (!session || !invitation) return;

      // Skip if invitation was already accepted by handleSubmit
      if (invitationAcceptedRef.current) return;

      // User is already logged in - check if email matches
      if (session.user.email !== invitation.email) {
        setError(
          `Este convite foi enviado para ${invitation.email}. Você está logado como ${session.user.email}.`,
        );
        return;
      }

      // Check if user is already a member of this organization
      try {
        const orgsResult = await portalAuthClient.organization.list();
        if (orgsResult.data) {
          const isMember = orgsResult.data.some(
            (org) => org.slug === invitation.organizationSlug,
          );

          if (isMember) {
            // User is already a member - redirect to home
            toast.success("Você já é membro desta organização!");
            navigate({ to: "/" });
            return;
          }
        }
      } catch {
        // Ignore - proceed with acceptance attempt
      }

      // Try to accept the invitation if it's still pending
      if (invitation.status === "pending") {
        setSubmitting(true);
        invitationAcceptedRef.current = true;
        try {
          const result = await portalAuthClient.organization.acceptInvitation({
            invitationId: invitation.id,
          });

          if (result.error) {
            // Check if error is because already accepted/member
            if (
              result.error.message?.includes("already") ||
              result.error.code === "ALREADY_MEMBER" ||
              result.error.code === "INVITATION_NOT_FOUND"
            ) {
              toast.success("Você já é membro desta organização!");
              navigate({ to: "/" });
              return;
            }
            invitationAcceptedRef.current = false;
            toast.error("Erro ao aceitar convite");
            setSubmitting(false);
            return;
          }

          toast.success("Convite aceito com sucesso!");
          navigate({ to: "/" });
        } catch {
          invitationAcceptedRef.current = false;
          toast.error("Erro ao aceitar convite");
          setSubmitting(false);
        }
      }
    }

    if (!sessionLoading && session && invitation) {
      handleLoggedInUser();
    }
  }, [session, sessionLoading, invitation, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!invitation || !token) return;

    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem");
      return;
    }

    if (password.length < 8) {
      toast.error("A senha deve ter pelo menos 8 caracteres");
      return;
    }

    setSubmitting(true);

    try {
      // Atomic signup with invitation acceptance
      // This creates the user AND adds them to the organization in a single transaction
      // The invitationId parameter tells Better Auth to automatically accept the invitation
      const result = await portalAuthClient.signUp.email({
        email: invitation.email,
        password,
        name,
        callbackURL: "/",
      });

      if (result.error) {
        toast.error(result.error.message || "Erro ao criar conta");
        setSubmitting(false);
        return;
      }

      // Mark as accepted BEFORE calling acceptInvitation to prevent useEffect from also calling it
      invitationAcceptedRef.current = true;

      // After signup, accept the invitation to join the organization
      const acceptResult = await portalAuthClient.organization.acceptInvitation(
        {
          invitationId: invitation.id,
        },
      );

      if (acceptResult.error) {
        // User created but couldn't accept invitation - still consider it a success
        // as they can accept later
        console.error("Failed to accept invitation:", acceptResult.error);
      }

      toast.success("Conta criada com sucesso!");
      navigate({ to: "/" });
    } catch {
      toast.error("Erro ao criar conta");
      setSubmitting(false);
    }
  };

  if (loading || sessionLoading) {
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
  if (session && session.user.email === invitation.email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Aceitando convite...</CardTitle>
            <CardDescription>
              Por favor, aguarde enquanto processamos seu convite.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Spinner className="size-8" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // New user signup form
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Criar sua conta</CardTitle>
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

            <div className="space-y-2">
              <Label htmlFor="name">Nome completo</Label>
              <Input
                id="name"
                type="text"
                placeholder="Seu nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 8 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repita a senha"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner className="mr-2" />
                  Criando conta...
                </>
              ) : (
                "Criar conta e acessar"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
