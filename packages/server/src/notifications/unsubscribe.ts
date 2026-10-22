import { timingSafeEqual } from "node:crypto";
import { type NotificationType, notificationEvents, operationsNotificationTypes } from "@lunedo/shared";
import { eq } from "drizzle-orm";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { Database, Executor } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { SettingLockedError } from "../settings/service.js";
import type { ValueSigner } from "../sharing/signer.js";
import { digestEnabledSetting, notificationEventSettings } from "./types.js";

const PURPOSE = "notifications.unsubscribe";
const DIGEST = "digest";
const TOKEN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9]{1,64})\.([A-Za-z0-9_-]{43})$/;

export type UnsubscribeScope = { kind: "event"; event: string } | { kind: "digest" };

export interface UnsubscribeLinks {
  page: string;
  oneClick: string;
}

export function isSecurityEvent(eventId: string): boolean {
  return notificationEvents.some((event) => event.id === eventId && event.security);
}

export function isOperationsEvent(eventId: string): boolean {
  return notificationEvents.some(
    (event) =>
      event.id === eventId &&
      event.types.every((type) => operationsNotificationTypes.has(type as NotificationType)),
  );
}

export interface UnsubscribeState {
  scope: UnsubscribeScope;
  off: boolean;
}

export type UnsubscribeResult =
  | { applied: true; state: UnsubscribeState }
  | { applied: false; reason: "locked" };

export class UnsubscribeService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #signer: ValueSigner;

  constructor(options: { database: Database; settings: SettingsService; signer: ValueSigner }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#signer = options.signer;
  }

  async #mac(accountId: string, scope: string): Promise<Buffer> {
    return (await this.#signer.mac(PURPOSE)).update(`${accountId}\n${scope}`, "utf8").digest();
  }

  async token(accountId: string, scope: UnsubscribeScope): Promise<string> {
    const name = scope.kind === "digest" ? DIGEST : scope.event;
    return `${accountId}.${name}.${(await this.#mac(accountId, name)).toString("base64url")}`;
  }

  async links(
    accountId: string,
    scope: UnsubscribeScope,
    executor: Executor = this.#database,
  ): Promise<UnsubscribeLinks | null> {
    if (scope.kind === "event" && isSecurityEvent(scope.event)) return null;
    const url = await this.#settings.get(instanceUrlSetting, {}, { executor });
    if (!url) return null;
    const token = await this.token(accountId, scope);
    return {
      page: `${url}/unsubscribe/${token}`,
      oneClick: `${url}/api/v1/notifications/unsubscribe/${token}`,
    };
  }

  async #verify(token: string): Promise<{ accountId: string; scope: UnsubscribeScope } | null> {
    const match = TOKEN.exec(token);
    if (!match?.[1] || !match[2] || !match[3]) return null;
    const [, accountId, name, mac] = match;
    const scope: UnsubscribeScope | null =
      name === DIGEST
        ? { kind: "digest" }
        : notificationEvents.some((event) => event.id === name && !event.security)
          ? { kind: "event", event: name }
          : null;
    if (!scope) return null;
    const provided = Buffer.from(mac, "base64url");
    if (provided.toString("base64url") !== mac) return null;
    const expected = await this.#mac(accountId, name);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
    const [account] = await this.#database
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    return account ? { accountId, scope } : null;
  }

  async #off(accountId: string, scope: UnsubscribeScope): Promise<boolean> {
    const chain = { ...(await accountScopeChain(this.#database, accountId)), user: accountId };
    if (scope.kind === "digest") return !(await this.#settings.get(digestEnabledSetting, chain));
    const settings = notificationEventSettings.get(scope.event);
    return settings ? (await this.#settings.get(settings.email, chain)) === "off" : true;
  }

  async describe(token: string): Promise<UnsubscribeState | null> {
    const verified = await this.#verify(token);
    if (!verified) return null;
    return { scope: verified.scope, off: await this.#off(verified.accountId, verified.scope) };
  }

  async apply(token: string): Promise<UnsubscribeResult | null> {
    const verified = await this.#verify(token);
    if (!verified) return null;
    const { accountId, scope } = verified;
    const chain = { ...(await accountScopeChain(this.#database, accountId)), user: accountId };
    try {
      if (scope.kind === "digest") {
        await this.#settings.set(digestEnabledSetting, chain, "user", false);
      } else {
        const settings = notificationEventSettings.get(scope.event);
        if (settings) await this.#settings.set(settings.email, chain, "user", "off");
      }
    } catch (error) {
      if (error instanceof SettingLockedError) return { applied: false, reason: "locked" };
      throw error;
    }
    return { applied: true, state: { scope, off: await this.#off(accountId, scope) } };
  }
}
