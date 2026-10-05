import type { AuditLog } from "../audit/audit-log.js";
import { sessions } from "../auth/schema.js";
import type { Database } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { instanceUrlSchema, instanceUrlSetting } from "./instance-settings.js";
import type { Principal } from "./principal.js";

export type InstanceAddressSource = "environment" | "setting";

export interface InstanceAddress {
  url: string | null;
  source: InstanceAddressSource | null;
}

export class InstanceAddressConfiguredError extends Error {
  override name = "InstanceAddressConfiguredError";
}

export class InstanceAddressInvalidError extends Error {
  override name = "InstanceAddressInvalidError";
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export class InstanceAddressService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #audit: AuditLog;
  readonly #configured: string | undefined;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    audit: AuditLog;
    configuredUrl?: string | undefined;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#audit = options.audit;
    this.#configured = options.configuredUrl ? normalize(options.configuredUrl) : undefined;
  }

  async get(): Promise<InstanceAddress> {
    if (this.#configured) return { url: this.#configured, source: "environment" };
    const stored = await this.#settings.get(instanceUrlSetting, {});
    return stored ? { url: normalize(stored), source: "setting" } : { url: null, source: null };
  }

  async change(actor: Principal, url: string): Promise<{ url: string; endedSessions: number }> {
    if (this.#configured) throw new InstanceAddressConfiguredError("The address comes from the environment");
    const parsed = instanceUrlSchema.safeParse(normalize(url));
    if (!parsed.success) throw new InstanceAddressInvalidError("The address is not valid");
    const next = normalize(parsed.data);
    return this.#database.transaction(async (tx) => {
      const previous = await this.#settings.get(instanceUrlSetting, {}, { executor: tx });
      if (normalize(previous) === next) return { url: next, endedSessions: 0 };
      await this.#settings.set(instanceUrlSetting, {}, "instance", next, { tx });
      const ended = await tx.delete(sessions).returning({ id: sessions.id });
      await this.#audit.record(tx, {
        name: "instance.addressChanged",
        actor,
        targetId: null,
        fields: {
          url: next,
          previousUrl: previous ? normalize(previous) : null,
          endedSessions: ended.length,
        },
      });
      return { url: next, endedSessions: ended.length };
    });
  }

  async applyConfigured(): Promise<void> {
    const configured = this.#configured;
    if (!configured) return;
    const stored = await this.#settings.get(instanceUrlSetting, {});
    if (normalize(stored) === configured) return;
    await this.#settings.set(instanceUrlSetting, {}, "instance", configured);
  }
}
