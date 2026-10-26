/**
 * The Better Auth endpoints each surface exposes over HTTP (architecture review
 * P0-1).
 *
 * Better Auth mounts every endpoint of every plugin it is given: organization
 * create/update/delete, admin, SSO provider registration, member and invitation
 * management, account linking, user deletion... Most of that is server-side
 * machinery the product drives in-process (`labAuth.api.*`, which does not go
 * through this list) or through its own routes (`/api/sso`, `/api/units`,
 * `/api/sessions`, `/api/invitations`...). Only what the browsers and the
 * desktop shell actually call is reachable here; everything else is a 404.
 *
 * How the lists were derived: every Better Auth client call in `apps/web`,
 * `apps/portal` and `apps/desktop` (`labAuthClient`, `portalAuthClient` and the
 * hooks of `@calibra-facil/auth/client`), the two raw fetches of the magic-link
 * verification pages and the OIDC redirect URI built in `routes/sso.ts`, each
 * mapped to its endpoint path with the endpoint inventory of the instances
 * (`Object.values(createLabAuth().api).map((endpoint) => endpoint.path)`).
 * `auth-route-allowlist.spec.ts` pins the lists; add an entry here, with the
 * caller named, when a surface starts to need another endpoint.
 */
export type AuthSurface = "lab" | "portal";

type AuthMethod = "GET" | "POST";

type AllowedAuthRoute = {
  method: AuthMethod;
  /** Path under `/api/auth/<surface>`. `:providerId` is one path segment. */
  path: string;
};

const get = (path: string): AllowedAuthRoute => ({ method: "GET", path });
const post = (path: string): AllowedAuthRoute => ({ method: "POST", path });

/** Session, sign-out and the Better Auth error landing page (redirect target). */
const COMMON_ROUTES: readonly AllowedAuthRoute[] = [
  // useSession / getSession (the client reads it with GET; POST is its refresh form)
  get("/get-session"),
  post("/get-session"),
  post("/sign-out"),
  get("/error"),
  // Magic link: signIn.magicLink + the confirmation page's verify request.
  post("/sign-in/magic-link"),
  get("/magic-link/verify"),
  // Active organization switching and the lists that feed the switchers.
  get("/organization/list"),
  get("/organization/get-full-organization"),
  post("/organization/set-active"),
  post("/organization/accept-invitation"),
  // Profile name (settings page / portal profile).
  post("/update-user"),
];

const LAB_ROUTES: readonly AllowedAuthRoute[] = [
  ...COMMON_ROUTES,
  // Email OTP sign-in and account claim.
  post("/email-otp/send-verification-otp"),
  post("/sign-in/email-otp"),
  // Passkeys: sign-in ceremony, registration ceremony and the settings list.
  get("/passkey/generate-authenticate-options"),
  post("/passkey/verify-authentication"),
  get("/passkey/generate-register-options"),
  post("/passkey/verify-registration"),
  get("/passkey/list-user-passkeys"),
  post("/passkey/update-passkey"),
  post("/passkey/delete-passkey"),
  // Members and invitations of the laboratory (settings > organization).
  // `organization/update` only takes name, slug and logo: the profile fields
  // are `input: false` and written by `PATCH /api/organization/profile`.
  post("/organization/update"),
  post("/organization/invite-member"),
  post("/organization/cancel-invitation"),
  post("/organization/reject-invitation"),
  post("/organization/remove-member"),
  get("/organization/list-members"),
  get("/organization/list-invitations"),
  // Sessions of the person (settings > security). Revoking one session goes
  // through `/api/sessions`.
  get("/list-sessions"),
  post("/revoke-other-sessions"),
  post("/revoke-sessions"),
  // OIDC redirect URI of a laboratory's SSO provider (`routes/sso.ts`).
  get("/sso/callback/:providerId"),
];

const PORTAL_ROUTES: readonly AllowedAuthRoute[] = [...COMMON_ROUTES];

const ALLOWED_ROUTES: Record<AuthSurface, readonly AllowedAuthRoute[]> = {
  lab: LAB_ROUTES,
  portal: PORTAL_ROUTES,
};

const PROVIDER_SEGMENT = /^(?!\.+$)[A-Za-z0-9._~-]+$/;

function pathMatches(pattern: string, path: string): boolean {
  if (!pattern.includes(":")) return pattern === path;

  const patternSegments = pattern.split("/");
  const pathSegments = path.split("/");
  if (patternSegments.length !== pathSegments.length) return false;

  return patternSegments.every((segment, index) => {
    const actual = pathSegments[index] ?? "";
    return segment.startsWith(":")
      ? PROVIDER_SEGMENT.test(actual)
      : segment === actual;
  });
}

/**
 * Whether the surface exposes this Better Auth endpoint. `subPath` is the path
 * under `/api/auth/<surface>` (starting with `/`), compared exactly: a trailing
 * slash, an encoded separator or a different case is not an allowed path.
 */
export function isAllowedAuthRoute(
  surface: AuthSurface,
  method: string,
  subPath: string,
): boolean {
  return ALLOWED_ROUTES[surface].some(
    (route) => route.method === method && pathMatches(route.path, subPath),
  );
}

export function listAllowedAuthRoutes(surface: AuthSurface) {
  return ALLOWED_ROUTES[surface].map(
    (route) => `${route.method} ${route.path}`,
  );
}
