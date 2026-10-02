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
  // Without VITE_API_URL the API is reached on the same origin: the Vite dev
  // server proxies /api to DEV_API_ORIGIN (http://localhost:3000 by default),
  // and deployments put a reverse proxy in front of both.
  return typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:3000";
}
