import { useState } from "react";

let captured: { path: string; token: string } | null = null;

export function readLinkToken(hash: string): string | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const token = parameters.get("token");
  return token && /^[\w-]{20,128}$/.test(token) ? token : null;
}

export function captureLinkToken(): string | null {
  const location = globalThis.location;
  if (!location) return null;
  const token = readLinkToken(location.hash);
  if (token) {
    captured = { path: location.pathname, token };
    globalThis.history?.replaceState(globalThis.history.state, "", `${location.pathname}${location.search}`);
  }
  return captured?.path === location.pathname ? captured.token : null;
}

export function useLinkToken(): string | null {
  const [token] = useState(captureLinkToken);
  return token;
}
