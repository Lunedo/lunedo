export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
}

export function needsHttpsWarning(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return false;
  }
  return url.protocol === "http:" && !isLoopbackHost(url.hostname);
}
