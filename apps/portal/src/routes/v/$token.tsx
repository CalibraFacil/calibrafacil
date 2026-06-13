import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  Download04Icon,
  SecurityCheckIcon,
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
import { AccreditationSeal } from "@/components/accreditation-seal";
import { getApiBaseUrl } from "@/lib/utils";

export const Route = createFileRoute("/v/$token")({
  component: VerifyPage,
});

type VerificationData = {
  valid: boolean;
  jobId: string;
  status: string;
  hasDocument: boolean;
  lab: string;
  customer: string;
  asset: {
    name: string;
    tag: string;
  };
  service: string;
  performedAt: string | null;
  approvedAt: string | null;
  accreditation?: {
    accredited: boolean;
    number: string | null;
  };
  // Digital signature - ISO 17025 Clause 7.8.2.1(q)
  digitalSignature:
    | {
        signed: true;
        signedAt: string | null;
        signerName: string | null;
        signerCpfCnpj: string | null;
        certificateSerial: string | null;
        pdfHash: string | null;
        ltvEnabled: boolean | null;
      }
    | { signed: false };
  // Amendment lineage - ISO 17025 Clause 7.8.4.1
  isSuperseded: boolean;
  isAmendment: boolean;
  amendmentNumber: number | null;
  amendmentReason: string | null;
  supersededAt: string | null;
  supersededBy: {
    id: number;
    jobId: string;
    verificationToken: string;
  } | null;
  supersedes: {
    id: number;
    jobId: string;
    verificationToken: string;
  } | null;
};

function VerifyPage() {
  const { token } = Route.useParams();
  const [downloading, setDownloading] = useState(false);
  const verificationQuery = useQuery({
    queryKey: ["verification", token],
    queryFn: async (): Promise<VerificationData> => {
      const response = await fetch(`${getApiBaseUrl()}/api/verify/${token}`);

      if (!response.ok) {
        if (response.status === 404 || response.status === 400) {
          throw new Error("Certificado não encontrado ou inválido.");
        }
        throw new Error("Erro ao verificar certificado.");
      }

      // oxlint-disable-next-line typescript/consistent-type-assertions -- portal verification endpoint owns this DTO shape.
      const result = (await response.json()) as VerificationData;

      if (!result.valid) {
        throw new Error("Certificado não encontrado ou inválido.");
      }

      return result;
    },
  });
  const data = verificationQuery.data;
  const error =
    verificationQuery.error instanceof Error
      ? verificationQuery.error.message
      : null;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await fetch(
        `${getApiBaseUrl()}/api/verify/${token}/download`,
      );

      if (!response.ok) {
        throw new Error("Download failed");
      }

      const { url } = await response.json();
      window.location.href = url;
    } catch {
      toast.error("Erro ao baixar certificado");
    } finally {
      setDownloading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  // Loading state
  if (verificationQuery.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner className="size-8" />
      </div>
    );
  }

  // Error/Invalid state
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon
                icon={AlertCircleIcon}
                className="size-8 text-destructive"
              />
            </div>
            <CardTitle className="text-xl text-destructive">
              Certificado Inválido
            </CardTitle>
            <CardDescription>
              {error || "Certificado nao encontrado ou invalido."}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Valid state
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
            <HugeiconsIcon
              icon={SecurityCheckIcon}
              className="size-8 text-green-600 dark:text-green-500"
            />
          </div>
          <CardTitle className="text-xl text-green-600 dark:text-green-500">
            Certificado Válido
          </CardTitle>
          <CardDescription className="mt-2 text-2xl font-bold text-foreground">
            {data.jobId}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Ativo</p>
              <p className="font-medium">{data.asset.name}</p>
              <p className="text-xs text-muted-foreground">{data.asset.tag}</p>
            </div>

            <div>
              <p className="text-muted-foreground">Cliente</p>
              <p className="font-medium">{data.customer}</p>
            </div>

            <div>
              <p className="text-muted-foreground">Serviço</p>
              <p className="font-medium">{data.service}</p>
            </div>

            <div>
              <p className="text-muted-foreground">Data</p>
              <p className="font-medium">{formatDate(data.performedAt)}</p>
            </div>

            <div className="col-span-2">
              <p className="text-muted-foreground">Laboratório</p>
              <p className="font-medium">{data.lab}</p>
            </div>
          </div>

          {/* Accreditation seal - only for accredited-scope certificates */}
          {data.accreditation?.accredited && (
            <div className="flex items-center gap-4 rounded-lg border border-border p-3">
              <AccreditationSeal
                accreditationNumber={data.accreditation.number}
                width={72}
              />
              <div className="text-sm">
                <p className="font-medium text-foreground">
                  Calibração acreditada NBR ISO/IEC 17025
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  Emitido sob o escopo acreditado do laboratório
                  {data.accreditation.number
                    ? ` (CAL ${data.accreditation.number})`
                    : ""}
                  .
                </p>
              </div>
            </div>
          )}

          {/* Supersession status - ISO 17025 Clause 7.8.4.1 */}
          {data.isSuperseded && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
              <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={AlertCircleIcon} className="size-4" />
                Certificado substituído
              </p>
              <p className="mt-1 text-amber-700/80 dark:text-amber-400/80">
                Este certificado foi substituído por uma versão mais recente
                {data.supersededAt
                  ? ` em ${formatDate(data.supersededAt)}`
                  : ""}
                .
              </p>
              {data.supersededBy && (
                <a
                  href={`/v/${data.supersededBy.verificationToken}`}
                  className="mt-1 inline-block font-medium text-amber-800 underline dark:text-amber-300"
                >
                  Ver versão vigente: {data.supersededBy.jobId}
                </a>
              )}
            </div>
          )}

          {data.isAmendment && (
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium text-foreground">
                Retificação
                {data.amendmentNumber ? ` Nº ${data.amendmentNumber}` : ""}
              </p>
              {data.amendmentReason && (
                <p className="mt-1 text-muted-foreground">
                  {data.amendmentReason}
                </p>
              )}
            </div>
          )}

          {/* Digital signature - ISO 17025 Clause 7.8.2.1(q) */}
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <HugeiconsIcon
                icon={SecurityCheckIcon}
                className={
                  data.digitalSignature.signed
                    ? "size-4 text-green-600 dark:text-green-500"
                    : "size-4 text-muted-foreground"
                }
              />
              Assinatura digital
            </p>
            {data.digitalSignature.signed ? (
              <dl className="grid gap-1.5">
                {data.digitalSignature.signerName && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Signatário</dt>
                    <dd className="text-right font-medium">
                      {data.digitalSignature.signerName}
                    </dd>
                  </div>
                )}
                {data.digitalSignature.signerCpfCnpj && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">CPF/CNPJ</dt>
                    <dd className="text-right font-medium">
                      {data.digitalSignature.signerCpfCnpj}
                    </dd>
                  </div>
                )}
                {data.digitalSignature.signedAt && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Assinado em</dt>
                    <dd className="text-right font-medium">
                      {formatDate(data.digitalSignature.signedAt)}
                    </dd>
                  </div>
                )}
                {data.digitalSignature.certificateSerial && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      Série do certificado
                    </dt>
                    <dd className="text-right font-mono text-xs">
                      {data.digitalSignature.certificateSerial}
                    </dd>
                  </div>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Assinatura digital com certificado A1 (PAdES/PKCS#7).
                </p>
              </dl>
            ) : (
              <p className="text-muted-foreground">
                Este certificado não possui assinatura digital.
              </p>
            )}
          </div>

          {/* Download Button */}
          {data.hasDocument && (
            <Button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full"
              size="lg"
            >
              {downloading ? (
                <>
                  <Spinner className="mr-2 size-4" />
                  Baixando...
                </>
              ) : (
                <>
                  <HugeiconsIcon
                    icon={Download04Icon}
                    className="mr-2 size-4"
                  />
                  Baixar PDF Original
                </>
              )}
            </Button>
          )}

          {!data.hasDocument && (
            <p className="text-center text-sm text-muted-foreground">
              Documento ainda não disponível para download.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
