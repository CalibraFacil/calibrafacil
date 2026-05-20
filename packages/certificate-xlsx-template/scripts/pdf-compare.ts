import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type PdfPairDiff = {
  compared: boolean;
  pagesCompared: number;
  width: number;
  height: number;
  maxChannelDelta: number;
  changedPixels: number;
  changedPixelRatio: number;
  diffPpm?: string;
  warning?: string;
};

export async function comparePdfPair(options: {
  leftPdf: string;
  rightPdf: string;
  diffPpm?: string;
}): Promise<PdfPairDiff> {
  if (!hasCommand("pdftoppm")) {
    return {
      compared: false,
      pagesCompared: 0,
      width: 0,
      height: 0,
      maxChannelDelta: 0,
      changedPixels: 0,
      changedPixelRatio: 0,
      warning: "pdftoppm is not available; PDF raster diff was skipped.",
    };
  }

  const workdir = await mkdtemp(join(tmpdir(), "calibra-pdf-diff-"));

  try {
    const leftPages = await rasterizePages(
      options.leftPdf,
      join(workdir, "left"),
    );
    const rightPages = await rasterizePages(
      options.rightPdf,
      join(workdir, "right"),
    );
    const diff = comparePpmPages(leftPages, rightPages);

    if (options.diffPpm && diff.firstPageDiffPpm) {
      await writeFile(options.diffPpm, diff.firstPageDiffPpm);
    }

    return {
      compared: true,
      pagesCompared: diff.pagesCompared,
      width: diff.width,
      height: diff.height,
      maxChannelDelta: diff.maxChannelDelta,
      changedPixels: diff.changedPixels,
      changedPixelRatio: diff.changedPixels / diff.totalPixels,
      diffPpm: options.diffPpm,
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function hasCommand(command: string): boolean {
  return spawnSync(command, ["-h"], { stdio: "ignore" }).status === 0;
}

async function rasterizePages(pdfPath: string, outputPrefix: string) {
  const result = spawnSync("pdftoppm", ["-r", "96", pdfPath, outputPrefix], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `pdftoppm failed for ${pdfPath} with exit code ${result.status}.`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const directory = outputPrefix.slice(0, outputPrefix.lastIndexOf("/"));
  const prefix = outputPrefix.slice(outputPrefix.lastIndexOf("/") + 1);
  const files = (await readdir(directory))
    .filter((entry) => entry.startsWith(`${prefix}-`) && entry.endsWith(".ppm"))
    .sort((left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
    );

  return Promise.all(files.map((file) => parsePpmFile(join(directory, file))));
}

async function parsePpmFile(path: string) {
  return parsePpm(await readFile(path));
}

function parsePpm(bytes: Uint8Array): {
  width: number;
  height: number;
  pixels: Uint8Array;
} {
  let offset = 0;

  const readToken = () => {
    while (offset < bytes.length && isWhitespace(bytes[offset])) {
      offset += 1;
    }

    const start = offset;
    while (offset < bytes.length && !isWhitespace(bytes[offset])) {
      offset += 1;
    }

    return new TextDecoder().decode(bytes.slice(start, offset));
  };

  const magic = readToken();
  const width = Number.parseInt(readToken(), 10);
  const height = Number.parseInt(readToken(), 10);
  const max = Number.parseInt(readToken(), 10);

  if (magic !== "P6" || max !== 255 || !width || !height) {
    throw new Error("Unsupported PPM output from pdftoppm.");
  }

  while (offset < bytes.length && isWhitespace(bytes[offset])) {
    offset += 1;
  }

  return {
    width,
    height,
    pixels: bytes.slice(offset),
  };
}

function comparePpmPages(
  leftPages: Array<ReturnType<typeof parsePpm>>,
  rightPages: Array<ReturnType<typeof parsePpm>>,
) {
  if (leftPages.length !== rightPages.length) {
    throw new Error(
      `PDFs have different page counts: ${leftPages.length} vs ${rightPages.length}.`,
    );
  }

  let changedPixels = 0;
  let maxChannelDelta = 0;
  let totalPixels = 0;
  let firstPageDiffPpm: Buffer | undefined;

  for (let pageIndex = 0; pageIndex < leftPages.length; pageIndex += 1) {
    const left = leftPages[pageIndex];
    const right = rightPages[pageIndex];

    if (!left || !right) {
      throw new Error(`Missing raster page ${pageIndex + 1}.`);
    }

    const pageDiff = comparePpm(left, right);
    changedPixels += pageDiff.changedPixels;
    maxChannelDelta = Math.max(maxChannelDelta, pageDiff.maxChannelDelta);
    totalPixels += left.width * left.height;

    if (pageIndex === 0) {
      firstPageDiffPpm = pageDiff.diffPpm;
    }
  }

  const firstPage = leftPages[0];
  if (!firstPage) {
    throw new Error("PDF rasterization produced no pages.");
  }

  return {
    pagesCompared: leftPages.length,
    width: firstPage.width,
    height: firstPage.height,
    changedPixels,
    maxChannelDelta,
    totalPixels,
    firstPageDiffPpm,
  };
}

function comparePpm(
  left: ReturnType<typeof parsePpm>,
  right: ReturnType<typeof parsePpm>,
) {
  if (left.width !== right.width || left.height !== right.height) {
    throw new Error(
      `PDF rasters have different dimensions: ${left.width}x${left.height} vs ${right.width}x${right.height}.`,
    );
  }

  let changedPixels = 0;
  let maxChannelDelta = 0;
  const diffPixels = new Uint8Array(left.pixels.length);

  for (let index = 0; index < left.pixels.length; index += 3) {
    const leftRed = left.pixels[index] ?? 0;
    const leftGreen = left.pixels[index + 1] ?? 0;
    const leftBlue = left.pixels[index + 2] ?? 0;
    const rightRed = right.pixels[index] ?? 0;
    const rightGreen = right.pixels[index + 1] ?? 0;
    const rightBlue = right.pixels[index + 2] ?? 0;
    const redDelta = Math.abs(leftRed - rightRed);
    const greenDelta = Math.abs(leftGreen - rightGreen);
    const blueDelta = Math.abs(leftBlue - rightBlue);
    const delta = Math.max(redDelta, greenDelta, blueDelta);

    if (delta > 0) {
      changedPixels += 1;
    }

    maxChannelDelta = Math.max(maxChannelDelta, delta);
    diffPixels[index] = delta;
    diffPixels[index + 1] = 0;
    diffPixels[index + 2] = 0;
  }

  return {
    width: left.width,
    height: left.height,
    changedPixels,
    maxChannelDelta,
    diffPpm: Buffer.concat([
      Buffer.from(`P6\n${left.width} ${left.height}\n255\n`, "utf8"),
      Buffer.from(diffPixels),
    ]),
  };
}

function isWhitespace(value: number | undefined): boolean {
  return value === 9 || value === 10 || value === 13 || value === 32;
}
