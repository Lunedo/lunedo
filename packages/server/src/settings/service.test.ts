import { randomBytes } from "node:crypto";
import { uuidv7 } from "@pagehall/shared";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { z } from "zod";
import { createDatabase, type Database } from "../database/database.js";
import { NotificationListener } from "../database/notifications.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { createLogger } from "../logging/logger.js";
import { languageSetting, timeZoneSetting } from "./builtin.js";
import { defineSetting, type SettingDefinition, SettingsRegistry } from "./definition.js";
import {
  INSTANCE_SCOPE_ID,
  type ScopeChain,
  SettingError,
  SettingLockedError,
  SettingsService,
} from "./service.js";

const databaseUrl = inject("databaseUrl");
const logger = createLogger({ service: "test", level: "silent" });

function testSetting(options: Partial<SettingDefinition<string>> = {}): SettingDefinition<string> {
  return defineSetting({
    key: `test.setting${randomBytes(4).toString("hex")}`,
    schema: z.string().min(1),
    default: "default",
    levels: ["instance", "organization", "space", "user"],
    lockable: true,
    ...options,
  });
}

function chain(): Required<ScopeChain> {
  return { organization: uuidv7(), space: uuidv7(), user: uuidv7() };
}

describe("defineSetting", () => {
  it("validates the key, levels and default", () => {
    expect(() => testSetting({ key: "nomodule" })).toThrow("<module>.<name>");
    expect(() => testSetting({ levels: [] })).toThrow("applies to no level");
    expect(() => testSetting({ default: "" })).toThrow("does not match its schema");
  });

  it("orders levels from instance to user", () => {
    expect(testSetting({ levels: ["user", "instance"] }).levels).toEqual(["instance", "user"]);
  });
});

describe("SettingsRegistry", () => {
  it("rejects duplicate keys", () => {
    const setting = testSetting();
    const registry = new SettingsRegistry().register(setting as SettingDefinition<never>);
    expect(registry.get(setting.key)).toBe(setting);
    expect(() => registry.register(setting as SettingDefinition<never>)).toThrow("registered twice");
    expect(() => registry.get("test.unknown")).toThrow("Unknown setting");
  });
});

describe("built-in settings", () => {
  it("default to English and UTC and validate their values", () => {
    expect(languageSetting.default).toBe("en");
    expect(timeZoneSetting.default).toBe("UTC");
    expect(languageSetting.schema.safeParse("fr").success).toBe(false);
    expect(timeZoneSetting.schema.safeParse("Europe/Vienna").success).toBe(true);
    expect(timeZoneSetting.schema.safeParse("Mars/Olympus").success).toBe(false);
  });
});

describe.skipIf(!databaseUrl)("SettingsService", () => {
  let pool: DatabasePool;
  let database: Database;
  let settings: SettingsService;

  beforeAll(() => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    database = createDatabase(pool);
    settings = new SettingsService({ database, logger });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it("returns the default when nothing is set", async () => {
    const setting = testSetting();
    const explanation = await settings.explain(setting, chain());
    expect(explanation).toMatchObject({ value: "default", source: "default", lockedBy: null });
    expect(explanation.levels.map((level) => level.scope.level)).toEqual([
      "instance",
      "organization",
      "space",
      "user",
    ]);
  });

  it("uses the most specific value and reports its source", async () => {
    const setting = testSetting();
    const scopes = chain();
    await settings.set(setting, scopes, "instance", "instance value");
    expect(await settings.get(setting, scopes)).toBe("instance value");
    await settings.set(setting, scopes, "organization", "organization value");
    await settings.set(setting, scopes, "space", "space value");
    expect(await settings.get(setting, scopes)).toBe("space value");
    await settings.set(setting, scopes, "user", "user value");

    const explanation = await settings.explain(setting, scopes);
    expect(explanation.value).toBe("user value");
    expect(explanation.source).toEqual({ level: "user", id: scopes.user });
    expect(explanation.levels.map((level) => level.value)).toEqual([
      "instance value",
      "organization value",
      "space value",
      "user value",
    ]);

    expect(await settings.get(setting, { organization: scopes.organization })).toBe("organization value");
    expect(await settings.get(setting, { organization: uuidv7(), user: scopes.user })).toBe("user value");
    expect(await settings.get(setting, {})).toBe("instance value");
  });

  it("clears a level so the inherited value applies again", async () => {
    const setting = testSetting();
    const scopes = chain();
    await settings.set(setting, scopes, "organization", "organization value");
    await settings.set(setting, scopes, "user", "user value");
    await settings.clear(setting, scopes, "user");
    expect(await settings.explain(setting, scopes)).toMatchObject({
      value: "organization value",
      source: { level: "organization", id: scopes.organization },
    });
  });

  it("skips levels a setting does not apply to", async () => {
    const setting = testSetting({ levels: ["instance", "organization", "user"] });
    const scopes = chain();
    await expect(settings.set(setting, scopes, "space", "x")).rejects.toThrow(
      "cannot be set at the space level",
    );
    const explanation = await settings.explain(setting, scopes);
    expect(explanation.levels.find((level) => level.scope.level === "space")?.applies).toBe(false);
  });

  it("locks the value for lower levels", async () => {
    const setting = testSetting();
    const scopes = chain();
    await settings.set(setting, scopes, "user", "user value");
    await settings.set(setting, scopes, "organization", "organization value");
    await settings.lock(setting, scopes, "organization");

    const explanation = await settings.explain(setting, scopes);
    expect(explanation.value).toBe("organization value");
    expect(explanation.lockedBy).toEqual({ level: "organization", id: scopes.organization });
    expect(explanation.levels.find((level) => level.scope.level === "user")).toMatchObject({
      value: "user value",
      effective: false,
    });

    await expect(settings.set(setting, scopes, "user", "other")).rejects.toThrow(SettingLockedError);
    await expect(settings.set(setting, scopes, "space", "other")).rejects.toThrow(SettingLockedError);
    await expect(settings.clear(setting, scopes, "user")).rejects.toThrow(SettingLockedError);
    await settings.set(setting, scopes, "organization", "changed by the organization");
    expect(await settings.get(setting, scopes)).toBe("changed by the organization");

    await settings.unlock(setting, scopes, "organization");
    expect(await settings.get(setting, scopes)).toBe("user value");
  });

  it("locks an inherited value without storing one", async () => {
    const setting = testSetting();
    const scopes = chain();
    await settings.set(setting, scopes, "user", "user value");
    await settings.lock(setting, scopes, "organization");
    const explanation = await settings.explain(setting, scopes);
    expect(explanation).toMatchObject({ value: "default", source: "default" });
    expect(explanation.lockedBy?.level).toBe("organization");
  });

  it("lets a higher lock win over a lower one", async () => {
    const instanceSetting = testSetting();
    const scopes = chain();
    await settings.set(instanceSetting, scopes, "organization", "organization value");
    await settings.lock(instanceSetting, scopes, "organization");
    await settings.set(instanceSetting, scopes, "instance", "enforced");
    await settings.lock(instanceSetting, scopes, "instance");

    const explanation = await settings.explain(instanceSetting, scopes);
    expect(explanation.value).toBe("enforced");
    expect(explanation.lockedBy).toEqual({ level: "instance", id: INSTANCE_SCOPE_ID });
    await expect(settings.set(instanceSetting, scopes, "organization", "x")).rejects.toThrow(
      "locked at the instance level",
    );
    await expect(settings.unlock(instanceSetting, scopes, "organization")).rejects.toThrow(
      SettingLockedError,
    );

    await settings.unlock(instanceSetting, scopes, "instance");
    await settings.clear(instanceSetting, scopes, "instance");
  });

  it("validates values and lock rules", async () => {
    const setting = testSetting();
    const scopes = chain();
    await expect(settings.set(setting, scopes, "user", "")).rejects.toThrow(SettingError);
    await expect(settings.lock(setting, scopes, "user")).rejects.toThrow("lowest level");
    await expect(settings.lock(testSetting({ lockable: false }), scopes, "organization")).rejects.toThrow(
      "cannot be locked",
    );
    await expect(settings.set(setting, {}, "user", "x")).rejects.toThrow("no user");
  });

  it("removes all values of a scope", async () => {
    const setting = testSetting();
    const scopes = chain();
    await settings.set(setting, scopes, "user", "user value");
    await settings.removeScope({ level: "user", id: scopes.user });
    expect(await settings.get(setting, scopes)).toBe("default");
  });

  it("invalidates caches on other nodes", async () => {
    const setting = testSetting();
    const scopes = chain();
    const listener = new NotificationListener({ connectionString: databaseUrl, logger });
    const cached = new SettingsService({ database, logger });
    await cached.enableCache(listener);
    try {
      expect(await cached.get(setting, scopes)).toBe("default");
      await settings.set(setting, scopes, "organization", "changed elsewhere");
      const deadline = Date.now() + 5000;
      let value = await cached.get(setting, scopes);
      while (value !== "changed elsewhere" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        value = await cached.get(setting, scopes);
      }
      expect(value).toBe("changed elsewhere");
    } finally {
      await listener.close();
    }
  });
});
