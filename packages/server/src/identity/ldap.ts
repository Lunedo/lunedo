import { isUuid, type LdapConfig } from "@pagehall/shared";
import { AndFilter, EqualityFilter, escapeFilter, Filter, FilterParser, ResultCodeError } from "ldapts";
import {
  type CallbackInput,
  DirectoryConnectionError,
  type DirectoryGroupMatch,
  DirectorySignInError,
  type DirectorySignInFailure,
  type DirectoryTestResult,
  type DirectSignInInput,
  type DirectSignInResult,
  expectType,
  type IdentityProviderAdapter,
  type LdapProviderDefinition,
  type ProviderCapabilities,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderGroup,
  type ProviderProfile,
  ProviderResponseError,
  type RedirectSignInResult,
  type StartedAuthorization,
  type SynchronizedAccount,
} from "./adapter.js";
import { receivedClaims } from "./claims.js";
import {
  checkTransport,
  connectionFailure,
  DirectoryBindRejected,
  type DirectoryConnector,
  type DirectoryEntry,
  type DirectorySession,
  ldaptsConnector,
} from "./ldap-connection.js";

export const AD_NESTED_MEMBERSHIP = "1.2.840.113556.1.4.1941";
export const GROUP_DEPTH_LIMIT = 10;
const ACCOUNT_DISABLED = 0x2;
const NEVER_EXPIRES = [0n, 0x7fffffffffffffffn];
const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_600_000n;

const AD_FAILURES: Record<string, DirectorySignInFailure> = {
  "530": "outsideSignInHours",
  "532": "passwordExpired",
  "533": "accountDisabled",
  "701": "accountDisabled",
  "773": "passwordMustChange",
  "775": "accountLocked",
};

export function ldapCapabilities(_config: LdapConfig): ProviderCapabilities {
  return { groups: true, directorySync: true, disabledAccounts: true, groupsByName: false };
}

export function guidFromBytes(bytes: Buffer): string {
  if (bytes.length !== 16) throw new ProviderResponseError("An objectGUID is not 16 bytes long");
  const hex = (start: number, end: number, reverse: boolean) => {
    const part = [...bytes.subarray(start, end)];
    return (reverse ? part.reverse() : part).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`;
}

export function guidToBytes(guid: string): Buffer {
  const hex = guid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new ProviderResponseError("The identifier is not a GUID");
  const bytes = Buffer.from(hex, "hex");
  return Buffer.concat([
    Buffer.from(bytes.subarray(0, 4)).reverse(),
    Buffer.from(bytes.subarray(4, 6)).reverse(),
    Buffer.from(bytes.subarray(6, 8)).reverse(),
    bytes.subarray(8),
  ]);
}

export function activeDirectoryFailure(message: string): DirectorySignInFailure {
  const code = /\bdata ([0-9a-f]{3,4})\b/i.exec(message)?.[1]?.toLowerCase();
  return (code && AD_FAILURES[code]) || "invalidCredentials";
}

function isText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0xfffd || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)) return false;
  }
  return true;
}

function and(...filters: string[]): string {
  return `(&${filters.join("")})`;
}

function withObjectGuid(filter: string, guid: string): Filter {
  return new AndFilter({
    filters: [
      FilterParser.parseString(filter),
      new EqualityFilter({ attribute: "objectGUID", value: guidToBytes(guid) }),
    ],
  });
}

interface DirectoryUser {
  dn: string;
  subject: string;
  profile: Omit<ProviderProfile, "groups">;
  disabled: boolean;
  memberOf: string[];
}

export class LdapAdapter implements IdentityProviderAdapter {
  readonly type = "ldap" as const;
  readonly #allowInsecure: boolean;
  readonly #connect: DirectoryConnector;
  readonly #clock: () => Date;

  constructor(options: { allowInsecure: boolean; connector?: DirectoryConnector; clock?: () => Date }) {
    this.#allowInsecure = options.allowInsecure;
    this.#connect = options.connector ?? ldaptsConnector;
    this.#clock = options.clock ?? (() => new Date());
  }

  async authorizationUrl(): Promise<StartedAuthorization> {
    throw new ProviderResponseError("Directory providers sign in on the Pagehall page");
  }

  async completeSignIn(
    _provider: ProviderDefinition,
    _credentials: readonly ProviderCredential[],
    _input: CallbackInput,
  ): Promise<RedirectSignInResult> {
    throw new ProviderResponseError("Directory providers sign in on the Pagehall page");
  }

  hasDirectory(provider: ProviderDefinition): boolean {
    return provider.type === "ldap";
  }

  #open(provider: LdapProviderDefinition): DirectorySession {
    const target = {
      url: provider.config.url,
      startTls: provider.config.startTls,
      caCertificates: provider.caCertificates,
      allowInsecure: this.#allowInsecure,
    };
    checkTransport(target);
    return this.#connect(target);
  }

  async #serviceSession<T>(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    run: (session: DirectorySession, ldap: LdapProviderDefinition) => Promise<T>,
  ): Promise<T> {
    const ldap = expectType(provider, "ldap");
    const passwords = credentials.filter((credential) => credential.kind === "bindPassword");
    if (passwords.length === 0) {
      throw new DirectoryConnectionError(
        "serviceAccountRejected",
        "The provider has no service account password",
      );
    }
    let rejected: unknown = null;
    for (const password of passwords) {
      const session = this.#open(ldap);
      try {
        await session.bind(ldap.config.bindDn, password.secret);
      } catch (error) {
        await session.close();
        if (error instanceof DirectoryBindRejected || error instanceof ResultCodeError) {
          rejected = error;
          continue;
        }
        throw connectionFailure(error);
      }
      try {
        return await run(session, ldap);
      } finally {
        await session.close();
      }
    }
    throw new DirectoryConnectionError(
      "serviceAccountRejected",
      `The directory refused the service account: ${(rejected as Error | null)?.message ?? "no password"}`,
    );
  }

  #isActiveDirectory(provider: LdapProviderDefinition): boolean {
    return provider.config.preset === "activeDirectory";
  }

  #userAttributes(provider: LdapProviderDefinition): { attributes: string[]; binary: string[] } {
    const config = provider.config;
    if (config.preset === "activeDirectory") {
      const attributes = new Set([
        "objectGUID",
        config.attributes.email,
        "userPrincipalName",
        "sAMAccountName",
        config.attributes.displayName,
        "cn",
        "userAccountControl",
        "accountExpires",
      ]);
      return { attributes: [...attributes], binary: ["objectGUID"] };
    }
    const attributes = new Set([
      "entryUUID",
      config.attributes.email,
      config.attributes.signInName,
      config.attributes.displayName,
      ...(config.groupMembership === "memberOf" ? ["memberOf"] : []),
      ...(config.disabled ? [config.disabled.attribute] : []),
    ]);
    return { attributes: [...attributes], binary: [] };
  }

  #user(provider: LdapProviderDefinition, entry: DirectoryEntry): DirectoryUser {
    const config = provider.config;
    if (config.preset === "activeDirectory") {
      const guid = entry.buffers("objectGUID")[0];
      if (!guid) throw new ProviderResponseError("A directory entry has no objectGUID");
      const control = Number(entry.values("userAccountControl")[0] ?? "0");
      const expires = BigInt(entry.values("accountExpires")[0] ?? "0");
      const expired =
        !NEVER_EXPIRES.includes(expires) &&
        Number(expires / 10_000n - WINDOWS_EPOCH_OFFSET_MS) <= this.#clock().getTime();
      const signInName =
        config.signInAttribute === "sAMAccountName"
          ? (entry.values("sAMAccountName")[0] ?? null)
          : (entry.values("userPrincipalName")[0] ?? null);
      return {
        dn: entry.dn,
        subject: guidFromBytes(guid),
        profile: {
          subject: guidFromBytes(guid),
          email: entry.values(config.attributes.email)[0] ?? null,
          signInName,
          displayName: entry.values(config.attributes.displayName)[0] ?? entry.values("cn")[0] ?? null,
        },
        disabled: (control & ACCOUNT_DISABLED) !== 0 || expired,
        memberOf: [],
      };
    }
    const subject = entry.values("entryUUID")[0]?.toLowerCase();
    if (!subject) throw new ProviderResponseError("A directory entry has no entryUUID");
    const disabledValues = config.disabled ? entry.values(config.disabled.attribute) : [];
    const disabled =
      config.disabled !== null &&
      (config.disabled.values.length === 0
        ? disabledValues.length > 0
        : disabledValues.some((value) =>
            config.disabled?.values.some((candidate) => candidate.toLowerCase() === value.toLowerCase()),
          ));
    return {
      dn: entry.dn,
      subject,
      profile: {
        subject,
        email: entry.values(config.attributes.email)[0] ?? null,
        signInName: entry.values(config.attributes.signInName)[0] ?? null,
        displayName: entry.values(config.attributes.displayName)[0] ?? null,
      },
      disabled,
      memberOf: config.groupMembership === "memberOf" ? entry.values("memberOf") : [],
    };
  }

  #signInFilter(provider: LdapProviderDefinition, signInName: string): string {
    return and(provider.config.userFilter, escapeFilter`(${provider.config.signInAttribute}=${signInName})`);
  }

  #subjectFilter(provider: LdapProviderDefinition, subject: string): string | Filter {
    if (this.#isActiveDirectory(provider)) return withObjectGuid(provider.config.userFilter, subject);
    return and(provider.config.userFilter, escapeFilter`(entryUUID=${subject})`);
  }

  async #findUser(
    session: DirectorySession,
    provider: LdapProviderDefinition,
    filter: string | Filter,
  ): Promise<DirectoryUser | null> {
    const { attributes, binary } = this.#userAttributes(provider);
    const entries = await session.search(provider.config.userBaseDn, {
      scope: "sub",
      filter,
      attributes,
      binaryAttributes: binary,
      sizeLimit: 2,
    });
    if (entries.length !== 1 || !entries[0]) return null;
    return this.#user(provider, entries[0]);
  }

  #group(provider: LdapProviderDefinition, entry: DirectoryEntry): ProviderGroup & { dn: string } {
    const config = provider.config;
    if (config.preset === "activeDirectory") {
      const guid = entry.buffers("objectGUID")[0];
      if (!guid) throw new ProviderResponseError("A group has no objectGUID");
      return { dn: entry.dn, id: guidFromBytes(guid), name: entry.values("cn")[0] ?? null };
    }
    const id = entry.values("entryUUID")[0]?.toLowerCase();
    if (!id) throw new ProviderResponseError("A group has no entryUUID");
    return { dn: entry.dn, id, name: entry.values(config.attributes.groupName)[0] ?? null };
  }

  #groupAttributes(provider: LdapProviderDefinition): { attributes: string[]; binary: string[] } {
    const config = provider.config;
    if (config.preset === "activeDirectory")
      return { attributes: ["objectGUID", "cn"], binary: ["objectGUID"] };
    return {
      attributes: [
        "entryUUID",
        config.attributes.groupName,
        ...(config.groupMembership === "memberOf" ? ["memberOf"] : []),
      ],
      binary: [],
    };
  }

  async #groupsOf(
    session: DirectorySession,
    provider: LdapProviderDefinition,
    user: DirectoryUser,
  ): Promise<ProviderGroup[]> {
    const config = provider.config;
    const { attributes, binary } = this.#groupAttributes(provider);
    if (config.preset === "activeDirectory") {
      const entries = await session.search(config.groupBaseDn, {
        scope: "sub",
        filter: and(config.groupFilter, `(member:${AD_NESTED_MEMBERSHIP}:=${Filter.escape(user.dn)})`),
        attributes,
        binaryAttributes: binary,
      });
      return entries.map((entry) => {
        const { dn: _dn, ...group } = this.#group(provider, entry);
        return group;
      });
    }
    const found = new Map<string, ProviderGroup>();
    const visited = new Set<string>([user.dn.toLowerCase()]);
    let frontier = [user.dn];
    let parents = user.memberOf;
    for (let depth = 0; depth < GROUP_DEPTH_LIMIT && frontier.length > 0; depth++) {
      let entries: DirectoryEntry[];
      if (config.groupMembership === "memberOf") {
        entries = [];
        for (const dn of parents) {
          if (visited.has(dn.toLowerCase())) continue;
          const [entry] = await session.search(dn, {
            scope: "base",
            filter: config.groupFilter,
            attributes,
            binaryAttributes: binary,
          });
          if (entry) entries.push(entry);
        }
      } else {
        const members = frontier.map((dn) => escapeFilter`(member=${dn})(uniqueMember=${dn})`).join("");
        entries = await session.search(config.groupBaseDn, {
          scope: "sub",
          filter: and(config.groupFilter, `(|${members})`),
          attributes,
          binaryAttributes: binary,
        });
      }
      const next: string[] = [];
      const nextParents: string[] = [];
      for (const entry of entries) {
        const key = entry.dn.toLowerCase();
        if (visited.has(key)) continue;
        visited.add(key);
        const { dn, ...group } = this.#group(provider, entry);
        found.set(group.id, group);
        next.push(dn);
        nextParents.push(...entry.values("memberOf"));
      }
      frontier = next;
      parents = nextParents;
    }
    return [...found.values()];
  }

  async authenticate(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: DirectSignInInput,
  ): Promise<DirectSignInResult> {
    if (input.password.length === 0 || input.signInName.trim().length === 0) {
      throw new DirectorySignInError("invalidCredentials", "A sign-in name and a password are required");
    }
    return this.#serviceSession(provider, credentials, async (session, ldap) => {
      const user = await this.#findUser(session, ldap, this.#signInFilter(ldap, input.signInName.trim()));
      if (!user) throw new DirectorySignInError("invalidCredentials", "No single directory entry matches");
      await this.#bindAs(ldap, user.dn, input.password);
      if (user.disabled)
        throw new DirectorySignInError("accountDisabled", "The directory account is disabled");
      let groups: ProviderGroup[] | null = null;
      let groupsFailed = false;
      try {
        groups = await this.#groupsOf(session, ldap, user);
      } catch {
        groupsFailed = true;
      }
      return { profile: { ...user.profile, groups }, groupsFailed };
    });
  }

  async #bindAs(provider: LdapProviderDefinition, dn: string, password: string): Promise<void> {
    if (password.length === 0) throw new DirectorySignInError("invalidCredentials", "The password is empty");
    const session = this.#open(provider);
    try {
      await session.bind(dn, password);
    } catch (error) {
      if (error instanceof DirectoryBindRejected) {
        const reason = this.#isActiveDirectory(provider)
          ? activeDirectoryFailure(error.message)
          : "invalidCredentials";
        throw new DirectorySignInError(reason, "The directory refused the password");
      }
      if (error instanceof ResultCodeError) {
        throw new DirectorySignInError(
          "invalidCredentials",
          `The directory refused the sign-in (${error.code})`,
        );
      }
      throw connectionFailure(error);
    } finally {
      await session.close();
    }
  }

  async verifyPassword(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
    password: string,
  ): Promise<boolean> {
    if (password.length === 0) return false;
    return this.#serviceSession(provider, credentials, async (session, ldap) => {
      const user = await this.#findUser(session, ldap, this.#subjectFilter(ldap, subject));
      if (!user) return false;
      try {
        await this.#bindAs(ldap, user.dn, password);
      } catch (error) {
        if (error instanceof DirectorySignInError && error.reason === "invalidCredentials") return false;
        throw error;
      }
      return !user.disabled;
    });
  }

  async readGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderGroup[] | null> {
    return this.#serviceSession(provider, credentials, async (session, ldap) => {
      const user = await this.#findUser(session, ldap, this.#subjectFilter(ldap, subject));
      return user ? this.#groupsOf(session, ldap, user) : null;
    });
  }

  async readProfile(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderProfile | null> {
    return this.#serviceSession(provider, credentials, async (session, ldap) => {
      const user = await this.#findUser(session, ldap, this.#subjectFilter(ldap, subject));
      return user ? { ...user.profile, groups: null } : null;
    });
  }

  async *synchronizeAccounts(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subjects: readonly string[],
  ): AsyncIterable<SynchronizedAccount> {
    const results = await this.#serviceSession(provider, credentials, async (session, ldap) => {
      const { attributes, binary } = this.#userAttributes(ldap);
      const entries = await session.search(ldap.config.userBaseDn, {
        scope: "sub",
        filter: ldap.config.userFilter,
        attributes,
        binaryAttributes: binary,
      });
      const users = new Map<string, DirectoryUser>();
      for (const entry of entries) {
        const user = this.#user(ldap, entry);
        users.set(user.subject, user);
      }
      const synchronized: SynchronizedAccount[] = [];
      for (const subject of subjects) {
        const user = users.get(subject);
        if (!user) {
          synchronized.push({ subject, state: "deleted", profile: null });
          continue;
        }
        if (user.disabled) {
          synchronized.push({ subject, state: "disabled", profile: null });
          continue;
        }
        const groups = await this.#groupsOf(session, ldap, user);
        synchronized.push({ subject, state: "enabled", profile: { ...user.profile, groups } });
      }
      return synchronized;
    });
    yield* results;
  }

  async readGroup(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<ProviderGroup | null> {
    const id = groupId.toLowerCase();
    if (!isUuid(id)) return null;
    return this.#serviceSession(provider, credentials, async (session, ldap) => {
      const { attributes, binary } = this.#groupAttributes(ldap);
      const [entry] = await session.search(ldap.config.groupBaseDn, {
        scope: "sub",
        filter: this.#isActiveDirectory(ldap)
          ? withObjectGuid(ldap.config.groupFilter, id)
          : and(ldap.config.groupFilter, escapeFilter`(entryUUID=${id})`),
        attributes,
        binaryAttributes: binary,
        sizeLimit: 1,
      });
      if (!entry) return null;
      const { dn: _dn, ...group } = this.#group(ldap, entry);
      return group;
    });
  }

  async searchGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    query: string,
  ): Promise<DirectoryGroupMatch[]> {
    return this.#serviceSession(provider, credentials, async (session, ldap) => {
      const nameAttribute =
        ldap.config.preset === "activeDirectory" ? "cn" : ldap.config.attributes.groupName;
      const { attributes, binary } = this.#groupAttributes(ldap);
      const entries = await session.search(ldap.config.groupBaseDn, {
        scope: "sub",
        filter: and(ldap.config.groupFilter, `(${nameAttribute}=*${Filter.escape(query.trim())}*)`),
        attributes,
        binaryAttributes: binary,
        sizeLimit: 25,
      });
      return entries.map((entry) => {
        const { dn: _dn, ...group } = this.#group(ldap, entry);
        return { ...group, members: null };
      });
    });
  }

  async countMembers(): Promise<number | null> {
    return null;
  }

  async testDirectory(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    signInName: string | null,
  ): Promise<DirectoryTestResult> {
    const steps: DirectoryTestResult["steps"] = [];
    try {
      return await this.#serviceSession(provider, credentials, async (session, ldap) => {
        steps.push({ step: "connection", ok: true, detail: null });
        steps.push({ step: "certificate", ok: true, detail: null });
        steps.push({ step: "serviceAccount", ok: true, detail: null });
        const { attributes, binary } = this.#userAttributes(ldap);
        const [entry] = await session.search(ldap.config.userBaseDn, {
          scope: "sub",
          filter: signInName ? this.#signInFilter(ldap, signInName.trim()) : ldap.config.userFilter,
          attributes: ["*", ...attributes],
          binaryAttributes: binary,
          sizeLimit: 1,
        });
        const user = entry ? this.#user(ldap, entry) : null;
        if (!entry || !user) {
          steps.push({ step: "search", ok: false, detail: "No person matches the search" });
          return { steps, sample: null, attributes: [] };
        }
        const groups = await this.#groupsOf(session, ldap, user);
        steps.push({ step: "search", ok: true, detail: null });
        const names = new Map<string, string>();
        for (const name of [...entry.names(), ...attributes]) {
          if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
        }
        const received = new Map(
          [...names.values()].map((name) => [
            name,
            binary.includes(name)
              ? entry.buffers(name).map(guidFromBytes)
              : entry.values(name).filter(isText),
          ]),
        );
        return {
          steps,
          sample: { ...user.profile, groups },
          attributes: receivedClaims(received).filter((claim) => claim.values.length > 0),
        };
      });
    } catch (error) {
      if (!(error instanceof DirectoryConnectionError)) throw error;
      const failed = (step: DirectoryTestResult["steps"][number]["step"]) => {
        const order = ["connection", "certificate", "serviceAccount", "search"] as const;
        for (const name of order) {
          if (steps.some((entry) => entry.step === name)) continue;
          if (name === step) {
            steps.push({ step: name, ok: false, detail: error.message });
            break;
          }
          steps.push({ step: name, ok: true, detail: null });
        }
      };
      switch (error.reason) {
        case "unreachable":
        case "insecureConnection":
          failed("connection");
          break;
        case "certificateUntrusted":
        case "certificateInvalid":
          failed("certificate");
          break;
        case "serviceAccountRejected":
          failed("serviceAccount");
          break;
        case "searchFailed":
          failed("search");
          break;
      }
      return { steps, sample: null, attributes: [] };
    }
  }
}
