import { Link, createFileRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { File01Icon, Wrench01Icon } from "@hugeicons/core-free-icons";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/")({
  component: PortalHome,
});

function PortalHome() {
  return (
    <div className="space-y-6">
      {/* Welcome Card */}
      <Card>
        <CardHeader>
          <CardTitle>Bem-vindo ao Portal do Cliente</CardTitle>
          <CardDescription>
            Acompanhe seus ativos, calibracoes e certificados em um so lugar.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Feature Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Assets Card */}
        <Card className="hover:bg-muted/50 transition-colors">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <HugeiconsIcon
                  icon={Wrench01Icon}
                  className="size-5 text-primary"
                />
              </div>
              <div>
                <CardTitle className="text-lg">Ativos</CardTitle>
                <CardDescription>
                  Visualize e gerencie seus instrumentos
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              render={<Link to="/assets" />}
            >
              Ver Ativos
            </Button>
          </CardContent>
        </Card>

        {/* Certificates Card */}
        <Card className="hover:bg-muted/50 transition-colors">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <HugeiconsIcon
                  icon={File01Icon}
                  className="size-5 text-primary"
                />
              </div>
              <div>
                <CardTitle className="text-lg">Certificados</CardTitle>
                <CardDescription>
                  Acesse certificados de calibracao
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              render={<Link to="/certificates" />}
            >
              Ver Certificados
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
