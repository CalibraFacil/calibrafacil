// Marketing analytics config for the Next marketing site. The GTM container is
// public (ships in the browser); the tag stack (GA4/Meta/LinkedIn/Clarity) is
// configured inside GTM. Loaded in PROD only (see layout.tsx); dev stays clean.
export const CONSENT_STORAGE_KEY = "cf-cookie-consent";
export const GTM_CONTAINER_ID = "GTM-XXXXXXX";
