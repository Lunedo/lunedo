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
  if (Buffer.isBuffer(value)) return value.equals(Buffer.from(expected, "latin1"));
  return value.toLowerCase() === expected.toLowerCase();
}

export class FakeLdapDirectory {
  readonly entries: FakeLdapEntry[] = [];
  readonly binds: FakeBind[] = [];
  readonly filters: string[] = [];
  readonly targets: DirectoryTarget[] = [];

  constructor(entries: FakeLdapEntry[] = []) {
    this.entries.push(...entries);
  }

  find(dn: string): FakeLdapEntry | undefined {
    return this.entries.find((entry) => normalize(entry.dn) === normalize(dn));
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
      return valuesOf(entry, filter.attribute).some((value) => equal(value, String(filter.value)));
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
    this.filters.push(search.filter);
    const filter = FilterParser.parseString(search.filter);
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
        const entry = this.find(dn);
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
