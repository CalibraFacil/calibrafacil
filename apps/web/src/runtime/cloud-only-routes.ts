export function isCloudOnlyDashboardPath(pathname: string) {
  return [
    /^\/dashboard\/reports\/?$/,
    /^\/dashboard\/requests(?:\/.*)?$/,
    /^\/dashboard\/nc(?:\/.*)?$/,
    /^\/dashboard\/capa(?:\/.*)?$/,
    /^\/dashboard\/certificate-templates\/?$/,
    /^\/dashboard\/finance(?:\/.*)?$/,
    /^\/dashboard\/settings(?:\/.*)?$/,
    /^\/dashboard\/customer-success\/?$/,
    /^\/dashboard\/internal(?:\/.*)?$/,
  ].some((pattern) => pattern.test(pathname))
}
