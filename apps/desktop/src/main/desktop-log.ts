import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

let installed = false;

export function getDesktopLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "desktop.log");
}

export function installDesktopLogger() {
  if (installed) return;
  installed = true;

  const originalLog = console.log.bind(console);
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args) => {
    originalLog(...args);
    appendDesktopLog("info", args, originalError);
  };
  console.warn = (...args) => {
    originalWarn(...args);
    appendDesktopLog("warn", args, originalError);
  };
  console.error = (...args) => {
    originalError(...args);
    appendDesktopLog("error", args, originalError);
  };
}

function appendDesktopLog(
  level: "info" | "warn" | "error",
  args: unknown[],
  onError: (...args: unknown[]) => void,
) {
  const line = `${new Date().toISOString()} [desktop] [${level}] ${formatArgs(
    args,
  )}\n`;
  const filePath = getDesktopLogFilePath();

  void mkdir(path.dirname(filePath), { recursive: true })
    .then(() => appendFile(filePath, line, "utf8"))
    .catch((error) => {
      onError(
        error instanceof Error
          ? `Failed to append desktop log: ${error.message}`
          : "Failed to append desktop log.",
      );
    });
}

function formatArgs(args: unknown[]) {
  return args.map(formatArg).join(" ");
}

function formatArg(arg: unknown): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}\n${arg.stack ?? ""}`.trim();
  }

  if (typeof arg === "string") {
    return arg;
  }

  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}
