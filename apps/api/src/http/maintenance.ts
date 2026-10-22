export const MAINTENANCE_ALLOWED_WRITES = [
  "POST /api/v1/auth/sign-in",
  "POST /api/v1/auth/sign-in/second-factor",
  "POST /api/v1/auth/sign-in/second-factor/passkey-options",
  "POST /api/v1/auth/sign-in/passkey",
  "POST /api/v1/auth/sign-in/passkey-options",
  "POST /api/v1/auth/sign-in/discover",
  "POST /api/v1/auth/sign-out",
  "POST /api/v1/auth/reauthenticate",
  "POST /api/v1/auth/reauthenticate/passkey-options",
  "POST /api/v1/auth/reauthenticate/provider",
  "POST /api/v1/auth/reauthenticate/directory",
  "POST /api/v1/auth/providers/:providerId/start",
  "POST /api/v1/auth/providers/:providerId/saml/acs",
  "POST /api/v1/auth/providers/:providerId/password",
  "POST /api/v1/auth/providers/:providerId/backchannel-logout",
  "POST /scim/v2/:providerId/Users",
  "PUT /scim/v2/:providerId/Users/:id",
  "PATCH /scim/v2/:providerId/Users/:id",
  "DELETE /scim/v2/:providerId/Users/:id",
  "POST /scim/v2/:providerId/Groups",
  "PUT /scim/v2/:providerId/Groups/:id",
  "PATCH /scim/v2/:providerId/Groups/:id",
  "DELETE /scim/v2/:providerId/Groups/:id",
  "PUT /api/v1/instance/maintenance",
  "POST /api/v1/instance/backups/runs",
  "POST /api/v1/instance/backups/files/:name/test-restore",
] as const;

export const SESSION_ROUTES = [
  "POST /api/v1/auth/sign-in",
  "POST /api/v1/auth/sign-in/second-factor",
  "POST /api/v1/auth/sign-in/passkey",
  "POST /api/v1/auth/providers/:providerId/password",
] as const;

const SESSION_ROUTE_SET: ReadonlySet<string> = new Set(SESSION_ROUTES);

export function createsSession(method: string, route: string): boolean {
  return SESSION_ROUTE_SET.has(`${method.toUpperCase()} ${route}`);
}

const READING_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED: ReadonlySet<string> = new Set(MAINTENANCE_ALLOWED_WRITES);

export function writesDuringMaintenance(method: string, route: string | undefined): "allowed" | "refused" {
  const upper = method.toUpperCase();
  if (READING_METHODS.has(upper)) return "allowed";
  return route !== undefined && ALLOWED.has(`${upper} ${route}`) ? "allowed" : "refused";
}

export const MAINTENANCE_RETRY_SECONDS = 60;
