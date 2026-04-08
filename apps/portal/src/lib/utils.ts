import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

import type { ClassValue } from "clsx";

export function cn(...inputs: Array<ClassValue>) {
  return twMerge(clsx(inputs));
}

export function getApiBaseUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost";

  if (host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return `https://${host}:3000`;
  }

  return "https://api.calibrafacil.com";
}
