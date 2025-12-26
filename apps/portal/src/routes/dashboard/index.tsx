import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/dashboard/")({
  component: DashboardIndex,
});

function DashboardIndex() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Portal do Cliente</CardTitle>
          <CardDescription>
            Bem-vindo ao portal do cliente. Aqui voce pode visualizar seus
            ativos e certificados de calibração.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Ativos</CardTitle>
                <CardDescription>
                  Visualize seus ativos e instrumentos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  render={<Link to="/dashboard/assets" />}
                  className="w-full"
                >
                  Ver Ativos
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Certificados</CardTitle>
                <CardDescription>
                  Acesse seus certificados de calibracao.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" disabled>
                  Em breve
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
