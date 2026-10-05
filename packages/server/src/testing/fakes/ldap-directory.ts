import { randomUUID } from "node:crypto";
import {
  AndFilter,
  EqualityFilter,
  ExtensibleFilter,
  type Filter,
  FilterParser,
  NotFilter,
  OrFilter,
  PresenceFilter,
  SubstringFilter,
} from "ldapts";
import { DirectoryConnectionError } from "../../identity/adapter.js";
import { guidToBytes } from "../../identity/ldap.js";
import type {
  DirectoryConnector,
  DirectoryEntry,
  DirectorySearch,
  DirectorySession,
  DirectoryTarget,
} from "../../identity/ldap-connection.js";
import { DirectoryBindRejected } from "../../identity/ldap-connection.js";

export const AD_NESTED_RULE = "1.2.840.113556.1.4.1941";

type Value = string | Buffer;

export interface FakeLdapEntry {
  dn: string;
  attributes: Record<string, Value[]>;
  password?: string;
  bindError?: string;
}

export interface FakeBind {
  dn: string;
  password: string;
}

function normalize(dn: string): string {
  return dn.replace(/\s*,\s*/g, ",").toLowerCase();
}

function valuesOf(entry: FakeLdapEntry, attribute: string): Value[] {
  const key = Object.keys(entry.attributes).find((name) => name.toLowerCase() === attribute.toLowerCase());
  if (attribute.toLowerCase() === "objectclass" && key === undefined) return [];
  return key === undefined ? [] : (entry.attributes[key] ?? []);
}

function equal(value: Value, expected: string): boolean {
  if (Buffer.isBuffer(value)) return value.equals(Buffer.from(expected, "utf8"));
  return value.toLowerCase() === expected.toLowerCase();
}

function sent(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}

export class FakeLdapDirectory {
  readonly entries: FakeLdapEntry[] = [];
  readonly binds: FakeBind[] = [];
  readonly filters: string[] = [];
  readonly targets: DirectoryTarget[] = [];
  readonly missingBases = new Set<string>();

  constructor(entries: FakeLdapEntry[] = []) {
    this.entries.push(...entries);
  }

  netbiosDomain: string | null = null;

  find(dn: string): FakeLdapEntry | undefined {
    return this.entries.find((entry) => normalize(entry.dn) === normalize(dn));
  }

  #bindTarget(name: string): FakeLdapEntry | undefined {
    if (name.includes("=")) return this.find(name);
    const [domain, logonName] = name.split("\\");
    if (logonName !== undefined) {
      if (domain?.toLowerCase() !== this.netbiosDomain?.toLowerCase()) return undefined;
      return this.entries.find((entry) =>
        valuesOf(entry, "sAMAccountName").some((value) => equal(value, logonName)),
      );
    }
    return this.entries.find((entry) =>
      valuesOf(entry, "userPrincipalName").some((value) => equal(value, name)),
    );
  }

  #memberOfTransitive(groupDn: string, memberDn: string, seen = new Set<string>()): boolean {
    const group = this.find(groupDn);
    if (!group || seen.has(normalize(groupDn))) return false;
    seen.add(normalize(groupDn));
    for (const member of valuesOf(group, "member")) {
      const dn = String(member);
      if (normalize(dn) === normalize(memberDn)) return true;
      if (this.#memberOfTransitive(dn, memberDn, seen)) return true;
    }
    return false;
  }

  #matches(entry: FakeLdapEntry, filter: Filter): boolean {
    if (filter instanceof AndFilter) return filter.filters.every((part) => this.#matches(entry, part));
    if (filter instanceof OrFilter) return filter.filters.some((part) => this.#matches(entry, part));
    if (filter instanceof NotFilter) return !this.#matches(entry, filter.filter);
    if (filter instanceof PresenceFilter) return valuesOf(entry, filter.attribute).length > 0;
    if (filter instanceof EqualityFilter) {
      const bytes = sent(filter.value);
      return valuesOf(entry, filter.attribute).some((value) =>
        Buffer.isBuffer(value) ? value.equals(bytes) : equal(value, bytes.toString("utf8")),
      );
    }
    if (filter instanceof SubstringFilter) {
      return valuesOf(entry, filter.attribute).some((value) => {
        const text = String(value).toLowerCase();
        const parts = [filter.initial ?? "", ...(filter.any ?? []), filter.final ?? ""].map((part) =>
          part.toLowerCase(),
        );
        let position = 0;
        if (!text.startsWith(parts[0] ?? "")) return false;
        for (const part of parts.slice(1, -1)) {
          const found = text.indexOf(part, position);
          if (found < 0) return false;
          position = found + part.length;
        }
        return text.endsWith(parts.at(-1) ?? "");
      });
    }
    if (filter instanceof ExtensibleFilter) {
      if (filter.rule !== AD_NESTED_RULE || filter.matchType !== "member") {
        throw new Error(`The fake directory does not support ${filter.toString()}`);
      }
      return this.#memberOfTransitive(entry.dn, filter.value);
    }
    throw new Error(`The fake directory does not support ${filter.toString()}`);
  }

  search(base: string, search: DirectorySearch): FakeLdapEntry[] {
    this.filters.push(typeof search.filter === "string" ? search.filter : search.filter.toString());
    if (search.scope === "sub" && this.missingBases.has(normalize(base))) {
      throw new DirectoryConnectionError("searchFailed", `The search base ${base} does not exist`);
    }
    const filter =
      typeof search.filter === "string" ? FilterParser.parseString(search.filter) : search.filter;
    const scoped = this.entries.filter((entry) =>
      search.scope === "base"
        ? normalize(entry.dn) === normalize(base)
        : normalize(entry.dn).endsWith(normalize(base)),
    );
    const matching = scoped.filter((entry) => this.#matches(entry, filter));
    return search.sizeLimit ? matching.slice(0, search.sizeLimit) : matching;
  }

  readonly connector: DirectoryConnector = (target) => {
    this.targets.push(target);
    const session: DirectorySession = {
      bind: async (dn, password) => {
        this.binds.push({ dn, password });
        if (password.length === 0) return;
        const entry = this.#bindTarget(dn);
        if (entry?.bindError) throw new DirectoryBindRejected(entry.bindError);
        if (!entry || entry.password !== password) {
          throw new DirectoryBindRejected(
            "80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data 52e, v4563",
          );
        }
      },
      search: async (base, search) =>
        this.search(base, search).map(
          (entry): DirectoryEntry => ({
            dn: entry.dn,
            names: () => Object.keys(entry.attributes),
            values: (attribute) =>
              valuesOf(entry, attribute).map((value) =>
                Buffer.isBuffer(value) ? value.toString("utf8") : value,
              ),
            buffers: (attribute) =>
              valuesOf(entry, attribute).map((value) =>
                Buffer.isBuffer(value) ? value : Buffer.from(value),
              ),
          }),
        ),
      close: async () => {},
    };
    return session;
  };
}

export function objectGuid(): Buffer {
  const bytes = guidToBytes(randomUUID());
  bytes[0] = (bytes[0] ?? 0) | 0x80;
  bytes[15] = 0x00;
  return bytes;
}
