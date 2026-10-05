import { isLoopbackHost } from "../forms/addresses.js";

export interface PublicAddress {
  hostname: string;
  port: number;
  socketProtocol: "ws" | "wss";
  forwardedHeaders: { "x-forwarded-proto": string; "x-forwarded-host": string };
}

export function publicAddress(instanceUrl: string | undefined): PublicAddress | null {
  if (!instanceUrl?.trim()) return null;
  let url: URL;
  try {
    url = new URL(instanceUrl.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || isLoopbackHost(url.hostname)) return null;
  const secure = url.protocol === "https:";
  return {
    hostname: url.hostname,
    port: url.port ? Number(url.port) : secure ? 443 : 80,
    socketProtocol: secure ? "wss" : "ws",
    forwardedHeaders: { "x-forwarded-proto": secure ? "https" : "http", "x-forwarded-host": url.host },
  };
}
