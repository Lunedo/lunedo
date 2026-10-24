export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
}

const HOST_FIRST = /^(localhost|[\p{L}\d-]+(\.[\p{L}\d-]+)+)(:\d+)?([/?#]|$)/iu;

export function completeWebAddress(value: string): string {
  const trimmed = value.trim();
  return HOST_FIRST.test(trimmed) ? `https://${trimmed}` : trimmed;
}

export function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}
