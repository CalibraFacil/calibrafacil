import { readOriginsConfig } from "@calibra-facil/config";

/**
 * The lab web app's address when the deployment configures one: `APP_URL`, else
 * the older `WEB_URL`, blank counts as unset, no trailing slash. It is the
 * origins reader of packages/config (`appBaseUrl`'s rule), the same one the API's
 * trusted app URL uses.
 */
export function configuredAppUrl(): string | undefined {
  const { appUrl, webUrl, appBaseUrl } = readOriginsConfig();
  return (appUrl ?? webUrl) ? appBaseUrl : undefined;
}

/**
 * The lab web app's address, for every link the auth package builds (magic link,
 * verification redirect, invitation, passkey origin). In production a
 * deployment that sets neither `APP_URL` nor `WEB_URL` fails loudly instead of
 * sending links to localhost.
 */
export function resolveWebBaseUrl(isProduction: boolean): string {
  const configured = configuredAppUrl();
  if (configured) return configured;
  if (isProduction) {
    throw new Error("APP_URL environment variable is required");
  }
  return readOriginsConfig().appBaseUrl;
}

/** The link in an organization invitation e-mail. */
export function organizationInvitationLink(
  invitationId: string,
  isProduction: boolean,
): string {
  return `${resolveWebBaseUrl(isProduction)}/accept-invitation/${invitationId}`;
}
