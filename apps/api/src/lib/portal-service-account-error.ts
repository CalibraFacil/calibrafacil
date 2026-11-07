/**
 * What the portal service account refuses with (a CLIENT organization's membership rules, a
 * duplicate invitation): its own status and code. Kept outside the portal domain because the
 * server's error handler maps it, and the server must not import a domain.
 */
export class PortalServiceAccountError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = "PORTAL_SERVICE_ERROR") {
    super(message);
    this.name = "PortalServiceAccountError";
    this.status = status;
    this.code = code;
  }
}
