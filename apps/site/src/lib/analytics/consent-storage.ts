import { CONSENT_STORAGE_KEY } from "./config";

// The visitor's stored cookie-consent choice. `analytics` gates GA4/Clarity,
// `ads` gates the Meta/LinkedIn advertising tags; `at` is the ISO timestamp the
// choice was recorded (evidence for the LGPD trail).
export type ConsentChoice = {
  analytics: boolean;
  ads: boolean;
  at: string;
};

function getLocalStorage() {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isConsentChoice(value: unknown): value is ConsentChoice {
  if (typeof value !== "object" || value === null) return false;
  if (!("analytics" in value) || !("ads" in value) || !("at" in value)) {
    return false;
  }
  return (
    typeof value.analytics === "boolean" &&
    typeof value.ads === "boolean" &&
    typeof value.at === "string"
  );
}

export function getStoredConsent(): ConsentChoice | null {
  const raw = getLocalStorage()?.getItem(CONSENT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isConsentChoice(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setStoredConsent(choice: ConsentChoice) {
  getLocalStorage()?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(choice));
}

export function hasStoredConsent() {
  return getStoredConsent() !== null;
}
