import { isIP } from "node:net";
import type { ConnectionOptions } from "node:tls";
import { Client, type Filter, InvalidCredentialsError, ResultCodeError } from "ldapts";
import { DirectoryConnectionError } from "./adapter.js";

const CONNECT_TIMEOUT_MS = 10_000;
const OPERATION_TIMEOUT_MS = 20_000;
const PAGE_SIZE = 500;

export interface DirectoryEntry {
  dn: string;
  names(): string[];
  values(attribute: string): string[];
  buffers(attribute: string): Buffer[];
}

export interface DirectorySearch {
  scope: "base" | "sub";
  filter: string | Filter;
  attributes: string[];
  binaryAttributes?: string[];
  sizeLimit?: number;
}

export interface DirectorySession {
  bind(dn: string, password: string): Promise<void>;
  search(base: string, search: DirectorySearch): Promise<DirectoryEntry[]>;
  close(): Promise<void>;
}

export interface DirectoryTarget {
  url: string;
  startTls: boolean;
  caCertificates: string | null;
  allowInsecure: boolean;
}

export type DirectoryConnector = (target: DirectoryTarget) => DirectorySession;

export class DirectoryBindRejected extends Error {
  override name = "DirectoryBindRejected";
}

const UNTRUSTED = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_UNTRUSTED",
]);
const INVALID = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_REVOKED",
]);

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

export function connectionFailure(error: unknown): DirectoryConnectionError {
  if (error instanceof DirectoryConnectionError) return error;
  const code = codeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  if (UNTRUSTED.has(code)) {
    return new DirectoryConnectionError(
      "certificateUntrusted",
      `The certificate of the directory server is not trusted (${code})`,
    );
  }
  if (INVALID.has(code)) {
    return new DirectoryConnectionError(
      "certificateInvalid",
      `The certificate of the directory server is not valid (${code})`,
    );
  }
  return new DirectoryConnectionError("unreachable", `The directory server could not be reached: ${message}`);
}

export function checkTransport(target: Pick<DirectoryTarget, "url" | "startTls" | "allowInsecure">): void {
  const secure = new URL(target.url).protocol === "ldaps:" || target.startTls;
  if (!secure && !target.allowInsecure) {
    throw new DirectoryConnectionError(
      "insecureConnection",
      "Directories must be reached through LDAPS or StartTLS",
    );
  }
}

function entryOf(raw: Record<string, unknown>): DirectoryEntry {
  const list = (attribute: string): unknown[] => {
    const key = Object.keys(raw).find((candidate) => candidate.toLowerCase() === attribute.toLowerCase());
    const value = key === undefined ? undefined : raw[key];
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  };
  return {
    dn: String(raw.dn ?? ""),
    names: () => Object.keys(raw).filter((name) => name !== "dn"),
    values: (attribute) =>
      list(attribute).flatMap((value) => {
        const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
        return text === "" ? [] : [text];
      }),
    buffers: (attribute) => list(attribute).flatMap((value) => (Buffer.isBuffer(value) ? [value] : [])),
  };
}

export const ldaptsConnector: DirectoryConnector = (target) => {
  checkTransport(target);
  const url = new URL(target.url);
  const tlsOptions: ConnectionOptions = {
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    ...(isIP(url.hostname) === 0 ? { servername: url.hostname } : {}),
    ...(target.caCertificates ? { ca: target.caCertificates } : {}),
  };
  const client = new Client({
    url: target.url,
    connectTimeout: CONNECT_TIMEOUT_MS,
    timeout: OPERATION_TIMEOUT_MS,
    ...(url.protocol === "ldaps:" ? { tlsOptions } : {}),
  });
  let upgraded = false;
  const ready = async () => {
    if (!target.startTls || upgraded) return;
    try {
      await client.startTLS(tlsOptions);
    } catch (error) {
      throw connectionFailure(error);
    }
    upgraded = true;
  };
  return {
    async bind(dn, password) {
      if (password.length === 0)
        throw new DirectoryBindRejected("An empty password is never sent to the directory");
      await ready();
      try {
        await client.bind(dn, password);
      } catch (error) {
        if (error instanceof InvalidCredentialsError) throw new DirectoryBindRejected(error.message);
        if (error instanceof ResultCodeError) throw error;
        throw connectionFailure(error);
      }
    },
    async search(base, search) {
      await ready();
      try {
        const result = await client.search(base, {
          scope: search.scope,
          filter: search.filter,
          attributes: search.attributes,
          explicitBufferAttributes: search.binaryAttributes ?? [],
          ...(search.sizeLimit ? { sizeLimit: search.sizeLimit } : { paged: { pageSize: PAGE_SIZE } }),
        });
        return result.searchEntries.map((entry) => entryOf(entry as Record<string, unknown>));
      } catch (error) {
        if (error instanceof ResultCodeError) {
          if (error.code === 32 && search.scope === "base") return [];
          if (error.code === 32) {
            throw new DirectoryConnectionError("searchFailed", `The search base ${base} does not exist`);
          }
          throw new DirectoryConnectionError("searchFailed", `The directory search failed: ${error.message}`);
        }
        throw connectionFailure(error);
      }
    },
    async close() {
      try {
        await client.unbind();
      } catch {
        return;
      }
    },
  };
};
