import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export interface ConvertOptions {
  fileName?: string;
  singlePageSheets?: boolean;
  pdfFormat?: "PDF/A-1a" | "PDF/A-2b" | "PDF/A-3b";
  timeoutMs?: number;
}

export type ConvertedPdf = {
  bytes: Uint8Array;
  metadata: {
    engine: "gotenberg-libreoffice" | "local-libreoffice";
    url?: string;
    command?: string;
    options: ConvertOptions;
  };
};

export interface XlsxToPdfConverter {
  convert(input: Uint8Array, options?: ConvertOptions): Promise<ConvertedPdf>;
}

export class GotenbergXlsxToPdfConverter implements XlsxToPdfConverter {
  private readonly url: string;

  constructor(url = process.env.GOTENBERG_URL) {
    if (!url) {
      throw new Error("GOTENBERG_URL is required for XLSX to PDF conversion.");
    }

    this.url = url.replace(/\/$/, "");
  }

  async convert(
    input: Uint8Array,
    options: ConvertOptions = {},
  ): Promise<ConvertedPdf> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 60_000,
    );

    try {
      const formData = new FormData();
      formData.set(
        "files",
        new Blob([new Uint8Array(input)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        options.fileName ?? "certificate.xlsx",
      );

      if (options.singlePageSheets != null) {
        formData.set("singlePageSheets", String(options.singlePageSheets));
      }

      if (options.pdfFormat) {
        formData.set("pdfFormat", options.pdfFormat);
      }

      const response = await fetch(`${this.url}/forms/libreoffice/convert`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Gotenberg conversion failed with ${response.status} ${response.statusText}`,
        );
      }

      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        metadata: {
          engine: "gotenberg-libreoffice",
          url: this.url,
          options,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class LocalLibreOfficeXlsxToPdfConverter implements XlsxToPdfConverter {
  private readonly command: string;

  constructor(
    command = process.env.LIBREOFFICE_BIN ?? findLibreOfficeCommand(),
  ) {
    if (!command) {
      throw new Error(
        "LIBREOFFICE_BIN, soffice, or libreoffice is required for local XLSX to PDF conversion.",
      );
    }

    this.command = command;
  }

  async convert(
    input: Uint8Array,
    options: ConvertOptions = {},
  ): Promise<ConvertedPdf> {
    const workdir = await mkdtemp(join(tmpdir(), "calibra-xlsx-pdf-"));
    const inputPath = join(workdir, sanitizeFileName(options.fileName));

    try {
      await writeFile(inputPath, input);
      await runCommand(
        this.command,
        ["--headless", "--convert-to", "pdf", "--outdir", workdir, inputPath],
        options.timeoutMs ?? 60_000,
      );

      const pdfPath = await findConvertedPdf(workdir, inputPath);

      return {
        bytes: new Uint8Array(await readFile(pdfPath)),
        metadata: {
          engine: "local-libreoffice",
          command: this.command,
          options,
        },
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
}

export function createConfiguredXlsxToPdfConverter(): XlsxToPdfConverter {
  if (process.env.GOTENBERG_URL) {
    return new GotenbergXlsxToPdfConverter();
  }

  return new LocalLibreOfficeXlsxToPdfConverter();
}

function findLibreOfficeCommand(): string | undefined {
  for (const command of ["soffice", "libreoffice"]) {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      stdio: "ignore",
    });

    if (result.status === 0) {
      return command;
    }
  }

  return undefined;
}

function sanitizeFileName(fileName = "certificate.xlsx"): string {
  const safe = basename(fileName).replace(/[^A-Za-z0-9_.-]/g, "_");
  return safe.endsWith(".xlsx") ? safe : `${safe}.xlsx`;
}

async function findConvertedPdf(
  directory: string,
  inputPath: string,
): Promise<string> {
  const expectedName = `${basename(inputPath, ".xlsx")}.pdf`;
  const entries = await readdir(directory);

  if (entries.includes(expectedName)) {
    return join(directory, expectedName);
  }

  const pdf = entries.find((entry) => entry.endsWith(".pdf"));
  if (!pdf) {
    throw new Error("LibreOffice did not produce a PDF output file.");
  }

  return join(directory, pdf);
}

async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(`LibreOffice conversion timed out after ${timeoutMs}ms.`),
      );
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);

      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          [
            `LibreOffice conversion failed with exit code ${code}.`,
            Buffer.concat(stdout).toString("utf8").trim(),
            Buffer.concat(stderr).toString("utf8").trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });
  });
}
