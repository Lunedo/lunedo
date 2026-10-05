import { useState } from "react";

const STORAGE_KEY = "pagehall.linkToken";

let captured: { path: string; token: string } | null = null;

export function readLinkToken(hash: string): string | null {
  const parameters = new URLSearchParams(hash.replace(/^#/, ""));
  const token = parameters.get("token");
  return token && /^[\w-]{20,128}$/.test(token) ? token : null;
}

function stored(): { path: string; token: string } | null {
  try {
    const value: unknown = JSON.parse(globalThis.sessionStorage?.getItem(STORAGE_KEY) ?? "null");
    if (
      typeof value === "object" &&
      value !== null &&
      "path" in value &&
      "token" in value &&
      typeof value.path === "string" &&
      typeof value.token === "string" &&
      readLinkToken(`token=${value.token}`) === value.token
    ) {
      return { path: value.path, token: value.token };
    }
  } catch {
    return null;
  }
  return null;
}

function store(value: { path: string; token: string } | null): void {
  try {
    if (value) globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(value));
    else globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function captureLinkToken(): string | null {
  const location = globalThis.location;
  if (!location) return null;
  const token = readLinkToken(location.hash);
  if (token) {
    captured = { path: location.pathname, token };
    store(captured);
    globalThis.history?.replaceState(globalThis.history.state, "", `${location.pathname}${location.search}`);
  }
  captured ??= stored();
  return captured?.path === location.pathname ? captured.token : null;
}

export function forgetLinkToken(): void {
  captured = null;
  store(null);
}

export function useLinkToken(): string | null {
  const [token] = useState(captureLinkToken);
  return token;
}
