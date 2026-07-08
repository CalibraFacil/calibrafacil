export interface Env {
  NODE_ENV: string;
  API_URL: string;
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  RESEND_FROM_EMAIL: string;
  RESEND_API_KEY: string;
  PORTAL_SERVICE_USER_ID: string;
  PORTAL_APP_URL?: string;
  PORTAL_INVITATION_EXPIRES_IN?: string;
  DATABASE_URL: string;
  INTERNAL_OPERATOR_EMAILS?: string;
  // Inbox that receives marketing-site lead notifications (SEO / lead-gen).
  SALES_INBOX_EMAIL?: string;
  BACKOFFICE_BOOTSTRAP_TOKEN?: string;
  [key: string]: unknown;
}
