import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  certificateNumberingAuditLog,
  certificateNumberingProfile,
  certificateNumberingSequence,
  organization,
  type CertificateNumberingConfig,
  type CertificateNumberingSnapshot,
  type CertificateSequenceResetScope,
} from "@calibra-facil/db/schema";
import { CertificateNumberingConfigSchema } from "@calibra-facil/schemas";
import { and, eq, sql } from "drizzle-orm";

type CertificateNumberingDbExecutor = Pick<
  typeof db,
  "execute" | "select" | "insert" | "update"
>;

type CertificateNumberingContext = {
  organizationId: string;
  generatedAt: Date;
  projectCode?: string | null;
  performedBy?: string | null;
};

type CertificateIdentity = {
  certificateNumber: string;
  certificateName: string;
  snapshot: CertificateNumberingSnapshot;
};

export const DEFAULT_CERTIFICATE_NUMBERING_CONFIG: CertificateNumberingConfig =
  {
    labCode: "CAL",
    projectCode: null,
    numberTemplate: "{labCode}-{yyyy}-{seq}",
    certificateNameTemplate: "Certificado {number}",
    sequence: {
      resetScope: "year",
      startAt: 1,
      increment: 1,
      padding: 4,
    },
  };

const SUPPORTED_TOKENS = new Set([
  "number",
  "labCode",
  "labName",
  "labSlug",
  "projectCode",
  "yyyy",
  "yy",
  "mm",
  "mon",
  "dd",
  "seq",
]);

const MONTH_ABBREVIATIONS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

function normalizeConfig(config: unknown): CertificateNumberingConfig {
  return CertificateNumberingConfigSchema.parse({
    ...DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
    ...(typeof config === "object" && config !== null ? config : {}),
    sequence: {
      ...DEFAULT_CERTIFICATE_NUMBERING_CONFIG.sequence,
      ...((typeof config === "object" &&
      config !== null &&
      "sequence" in config &&
      typeof config.sequence === "object" &&
      config.sequence !== null
        ? config.sequence
        : {}) as Record<string, unknown>),
    },
  });
}

export function getUnsupportedCertificateTokens(template: string): string[] {
  const tokens = new Set<string>();
  for (const match of template.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)) {
    const token = match[1];
    if (token && !SUPPORTED_TOKENS.has(token)) {
      tokens.add(token);
    }
  }
  return [...tokens];
}

export function validateCertificateNumberingConfig(
  config: CertificateNumberingConfig,
) {
  const unsupported = [
    ...getUnsupportedCertificateTokens(config.numberTemplate),
    ...getUnsupportedCertificateTokens(config.certificateNameTemplate),
  ];

  if (unsupported.length > 0) {
    throw new Error(
      `Tokens nao suportados: ${[...new Set(unsupported)].join(", ")}`,
    );
  }

  if (!config.numberTemplate.includes("{seq}")) {
    throw new Error("Formato do numero deve conter o token {seq}");
  }

  return config;
}

function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildTemplateTokens(params: {
  config: CertificateNumberingConfig;
  organizationName: string;
  generatedAt: Date;
  sequence: number;
  certificateNumber?: string;
}) {
  const yyyy = String(params.generatedAt.getFullYear());
  const month = params.generatedAt.getMonth() + 1;
  const projectCode =
    params.config.projectCode && params.config.projectCode.trim()
      ? params.config.projectCode.trim()
      : "GERAL";

  return {
    number: params.certificateNumber ?? "",
    labCode: params.config.labCode,
    labName: params.organizationName,
    labSlug: slugify(params.organizationName),
    projectCode,
    yyyy,
    yy: yyyy.slice(-2),
    mm: pad(month, 2),
    mon: MONTH_ABBREVIATIONS[month - 1] ?? "",
    dd: pad(params.generatedAt.getDate(), 2),
    seq: pad(params.sequence, params.config.sequence.padding),
  };
}

export function renderCertificateTemplate(
  template: string,
  tokens: Record<string, string>,
) {
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, token) =>
    typeof token === "string" && tokens[token] !== undefined
      ? tokens[token]
      : match,
  );
}

export function buildCertificateSequenceKey(
  resetScope: CertificateSequenceResetScope,
  context: CertificateNumberingContext,
  config: CertificateNumberingConfig,
) {
  const year = context.generatedAt.getFullYear();
  const month = context.generatedAt.getMonth() + 1;
  const projectCode =
    context.projectCode?.trim() || config.projectCode?.trim() || "GERAL";

  switch (resetScope) {
    case "never":
      return "global";
    case "year":
      return `year:${year}`;
    case "month":
      return `month:${year}-${pad(month, 2)}`;
    case "project":
      return `project:${projectCode}`;
  }
}

async function ensureCertificateNumberingProfile(
  organizationId: string,
  executor: CertificateNumberingDbExecutor,
) {
  const [existing] = await executor
    .select()
    .from(certificateNumberingProfile)
    .where(eq(certificateNumberingProfile.organizationId, organizationId))
    .limit(1);

  if (existing) {
    return {
      ...existing,
      config: validateCertificateNumberingConfig(
        normalizeConfig(existing.config),
      ),
    };
  }

  const [created] = await executor
    .insert(certificateNumberingProfile)
    .values({
      organizationId,
      name: "Padrao",
      config: DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
    })
    .onConflictDoNothing({
      target: certificateNumberingProfile.organizationId,
    })
    .returning();

  if (!created) {
    const [createdByConcurrentRequest] = await executor
      .select()
      .from(certificateNumberingProfile)
      .where(eq(certificateNumberingProfile.organizationId, organizationId))
      .limit(1);

    if (!createdByConcurrentRequest) {
      throw new Error("Falha ao criar perfil de numeracao de certificados");
    }

    return {
      ...createdByConcurrentRequest,
      config: validateCertificateNumberingConfig(
        normalizeConfig(createdByConcurrentRequest.config),
      ),
    };
  }

  await executor.insert(certificateNumberingAuditLog).values({
    organizationId,
    profileId: created.id,
    action: "create_default",
    changes: { config: DEFAULT_CERTIFICATE_NUMBERING_CONFIG },
  });

  return {
    ...created,
    config: DEFAULT_CERTIFICATE_NUMBERING_CONFIG,
  };
}

async function reserveNextSequence(params: {
  organizationId: string;
  profileId: number;
  sequenceKey: string;
  config: CertificateNumberingConfig;
  executor: CertificateNumberingDbExecutor;
}) {
  const { config } = params;
  const [sequence] = await params.executor
    .insert(certificateNumberingSequence)
    .values({
      organizationId: params.organizationId,
      profileId: params.profileId,
      sequenceKey: params.sequenceKey,
      currentValue: config.sequence.startAt,
    })
    .onConflictDoUpdate({
      target: [
        certificateNumberingSequence.organizationId,
        certificateNumberingSequence.profileId,
        certificateNumberingSequence.sequenceKey,
      ],
      set: {
        currentValue: sql`${certificateNumberingSequence.currentValue} + ${config.sequence.increment}`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (sequence?.currentValue == null) {
    throw new Error("Falha ao reservar sequencia de certificado");
  }

  return sequence.currentValue;
}

function buildCertificateIdentity(params: {
  profileId: number;
  profileName: string;
  config: CertificateNumberingConfig;
  organizationName: string;
  generatedAt: Date;
  sequenceKey: string;
  sequence: number;
}): CertificateIdentity {
  const baseTokens = buildTemplateTokens({
    config: params.config,
    organizationName: params.organizationName,
    generatedAt: params.generatedAt,
    sequence: params.sequence,
  });
  const certificateNumber = renderCertificateTemplate(
    params.config.numberTemplate,
    baseTokens,
  );
  const certificateName = renderCertificateTemplate(
    params.config.certificateNameTemplate,
    {
      ...baseTokens,
      number: certificateNumber,
    },
  );

  return {
    certificateNumber,
    certificateName,
    snapshot: {
      profileId: params.profileId,
      profileName: params.profileName,
      config: params.config,
      sequenceKey: params.sequenceKey,
      sequenceValue: params.sequence,
      generatedAt: params.generatedAt.toISOString(),
    },
  };
}

export async function generateCertificateIdentity(
  context: CertificateNumberingContext,
  executor?: CertificateNumberingDbExecutor,
): Promise<CertificateIdentity> {
  const run = async (tx: CertificateNumberingDbExecutor) => {
    const [org] = await tx
      .select({
        id: organization.id,
        name: organization.name,
      })
      .from(organization)
      .where(eq(organization.id, context.organizationId))
      .limit(1);

    if (!org) {
      throw new Error("Laboratorio nao encontrado");
    }

    const profile = await ensureCertificateNumberingProfile(
      context.organizationId,
      tx,
    );
    const sequenceKey = buildCertificateSequenceKey(
      profile.config.sequence.resetScope,
      context,
      profile.config,
    );

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const sequence = await reserveNextSequence({
        organizationId: context.organizationId,
        profileId: profile.id,
        sequenceKey,
        config: profile.config,
        executor: tx,
      });
      const identity = buildCertificateIdentity({
        profileId: profile.id,
        profileName: profile.name,
        config: profile.config,
        organizationName: org.name,
        generatedAt: context.generatedAt,
        sequenceKey,
        sequence,
      });

      const [collision] = await tx
        .select({ id: calibrationJob.id })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.organizationId, context.organizationId),
            eq(calibrationJob.jobId, identity.certificateNumber),
          ),
        )
        .limit(1);

      if (!collision) {
        await tx.insert(certificateNumberingAuditLog).values({
          organizationId: context.organizationId,
          profileId: profile.id,
          action: "generate",
          changes: {
            certificateNumber: identity.certificateNumber,
            certificateName: identity.certificateName,
            sequenceKey,
            sequenceValue: sequence,
          },
          performedBy: context.performedBy ?? null,
        });

        return identity;
      }
    }

    throw new Error(
      "Nao foi possivel gerar um numero de certificado unico para este laboratorio",
    );
  };

  return executor ? run(executor) : db.transaction(run);
}
