export interface Env {
  NODE_ENV: string;
  API_URL: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  RESEND_FROM_EMAIL?: string;
  EMAIL_FROM?: string;
  /** Platform e-mail: SMTP_* or RESEND_API_KEY (packages/email-sender/src/transport.ts). */
  EMAIL_TRANSPORT?: string;
  SMTP_HOST?: string;
  RESEND_API_KEY?: string;
  /**
   * 256-bit base64 key encrypting lab-owned Resend API keys at rest (#584).
   * Optional: without it the email-domain settings routes refuse key intake
   * and every send uses the platform sender. NEVER reuse SIGNING_MASTER_KEY.
   */
  EMAIL_DOMAIN_MASTER_KEY?: string;
  PORTAL_SERVICE_USER_ID: string;
  PORTAL_APP_URL?: string;
  PORTAL_INVITATION_EXPIRES_IN?: string;
  DATABASE_URL: string;
  [key: string]: unknown;
}
