import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { signOut, useSession } from "@calibra-facil/auth/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export const Route = createFileRoute("/")({
  component: PortalHome,
});

function PortalHome() {
  const navigate = useNavigate();
  const { data: session, isPending } = useSession();

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: "/sign-in" });
    }
  }, [isPending, session, navigate]);

  if (isPending || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/sign-in" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">
            Bem-vindo, {session.user.name}!
          </CardTitle>
          <CardDescription>
            Você está conectado ao Portal do Cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-muted-foreground">
            Em breve você poderá visualizar suas calibrações e certificados
            aqui.
          </p>
          <Button variant="outline" className="w-full" onClick={handleSignOut}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
