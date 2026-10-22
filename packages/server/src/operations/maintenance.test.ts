import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { NotificationListener } from "../database/notifications.js";
import { createLogger } from "../logging/logger.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import {
  MAINTENANCE_MESSAGE_MAX_LENGTH,
  MaintenanceInputError,
  MaintenanceModeError,
  MaintenanceService,
  type MaintenanceStatus,
} from "./maintenance.js";

const baseUrl = testDatabaseBaseUrl();
const logger = createLogger({ service: "test", level: "silent" });

async function waitFor(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(!baseUrl)("MaintenanceService", () => {
  let test: TestServices;
  let listener: NotificationListener;
  const fixtures = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    listener = new NotificationListener({ connectionString: test.url, logger });
  });

  afterAll(async () => {
    await listener?.close();
    await test?.close();
  });

  afterEach(async () => {
    await test.services.maintenance.set(SYSTEM, { enabled: false });
  });

  async function lastSequence(): Promise<number> {
    const result = await test.database.execute<{ sequence: string | number | null }>(
      sql`select max(sequence) as sequence from audit_events where scope_type = 'instance'`,
    );
    return Number(result.rows[0]?.sequence ?? 0);
  }

  async function auditNames(after: number): Promise<{ name: string; fields: Record<string, unknown> }[]> {
    const result = await test.database.execute<{ name: string; fields: Record<string, unknown> }>(
      sql`select name, fields from audit_events
        where scope_type = 'instance' and name like 'maintenance.%' and sequence > ${after}
        order by sequence`,
    );
    return result.rows;
  }

  it("switches maintenance on, changes its message and switches it off, and audits each step", async () => {
    const admin = await fixtures.account({ name: "Admin" });
    const maintenance = test.services.maintenance;
    const since = await lastSequence();
    expect(await maintenance.status()).toMatchObject({ enabled: false, message: "", blockSignIn: false });

    const on = await maintenance.set(accountPrincipal(admin), {
      enabled: true,
      message: "  Update   until 18:00 ",
      blockSignIn: true,
    });
    expect(on).toMatchObject({
      enabled: true,
      message: "Update until 18:00",
      blockSignIn: true,
      changedBy: admin,
    });
    expect(on.startedAt).toBeInstanceOf(Date);

    const same = await maintenance.set(accountPrincipal(admin), {
      enabled: true,
      message: "Update until 18:00",
      blockSignIn: true,
    });
    expect(same.changedAt).toEqual(on.changedAt);

    const changed = await maintenance.set(SYSTEM, { enabled: true, message: "Update until 19:00" });
    expect(changed).toMatchObject({ message: "Update until 19:00", blockSignIn: false, changedBy: null });
    expect(changed.startedAt).toEqual(on.startedAt);

    const off = await maintenance.set(accountPrincipal(admin), { enabled: false, message: "ignored" });
    expect(off).toMatchObject({ enabled: false, message: "", blockSignIn: false, startedAt: null });
    await maintenance.set(accountPrincipal(admin), { enabled: false });

    expect(await auditNames(since)).toEqual([
      { name: "maintenance.started", fields: { message: "Update until 18:00", blockSignIn: true } },
      { name: "maintenance.changed", fields: { message: "Update until 19:00", blockSignIn: false } },
      { name: "maintenance.ended", fields: { minutes: 0 } },
    ]);
  });

  it("refuses messages that are too long and changes nothing", async () => {
    await expect(
      test.services.maintenance.set(SYSTEM, {
        enabled: true,
        message: "x".repeat(MAINTENANCE_MESSAGE_MAX_LENGTH + 1),
      }),
    ).rejects.toBeInstanceOf(MaintenanceInputError);
    expect((await test.services.maintenance.status()).enabled).toBe(false);
  });

  it("refuses writes only while maintenance is on", async () => {
    await expect(test.services.maintenance.requireWritable()).resolves.toBeUndefined();
    await test.services.maintenance.set(SYSTEM, { enabled: true, message: "Back soon" });
    const refused = await test.services.maintenance.requireWritable().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(MaintenanceModeError);
    expect((refused as MaintenanceModeError).status.message).toBe("Back soon");
  });

  it("tells every node about a change through the database, without polling", async () => {
    const node = new MaintenanceService({ database: test.database, audit: test.services.audit });
    await node.enableCache(listener);
    const seen: MaintenanceStatus[] = [];
    node.onChange((status) => seen.push(status));
    expect((await node.status()).enabled).toBe(false);

    await test.services.maintenance.set(SYSTEM, { enabled: true, message: "From another node" });
    await waitFor(() => seen.length > 0);
    expect(seen.at(-1)).toMatchObject({ enabled: true, message: "From another node" });
    expect(await node.status()).toMatchObject({ enabled: true, message: "From another node" });

    await test.services.maintenance.set(SYSTEM, { enabled: false });
    await waitFor(() => seen.at(-1)?.enabled === false);
    expect((await node.status()).enabled).toBe(false);
  });

  it("lets two administrators switch at the same moment without a lost update", async () => {
    const maintenance = test.services.maintenance;
    const since = await lastSequence();
    await Promise.all([
      maintenance.set(SYSTEM, { enabled: true, message: "A" }),
      test.anotherNode().maintenance.set(SYSTEM, { enabled: true, message: "A" }),
    ]);
    expect((await auditNames(since)).map((entry) => entry.name)).toEqual(["maintenance.started"]);
  });
});
