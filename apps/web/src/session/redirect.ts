const AFTER_SIGN_IN = "/";

export function safeRedirect(target: string | undefined, origin = globalThis.location?.origin): string {
  if (!target) return AFTER_SIGN_IN;
  try {
    const base = origin ?? "http://localhost";
    const url = new URL(target, base);
    if (url.origin !== base) return AFTER_SIGN_IN;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/sign-in")) return AFTER_SIGN_IN;
    return path;
  } catch {
    return AFTER_SIGN_IN;
  }
}

export function currentLocation(): string {
  const location = globalThis.location;
  if (!location) return AFTER_SIGN_IN;
  return `${location.pathname}${location.search}${location.hash}`;
}
