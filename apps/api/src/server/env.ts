export interface Env {
  NODE_ENV: string;
  API_URL: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  RESEND_FROM_EMAIL: string;
  RESEND_API_KEY: string;
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
  // Inbox that receives marketing-site lead notifications (SEO / lead-gen).
  SALES_INBOX_EMAIL?: string;
  [key: string]: unknown;
}
