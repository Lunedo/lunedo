import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { SessionService } from "./sessions.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("resolving sessions", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  it("records one use for requests of a session that arrive at the same moment", async () => {
    const { services, database } = test;
    const account = await database.transaction((tx) =>
      services.accounts.createStandard(tx, {
        email: "touch@example.org",
        name: "Touch",
        password: "a long touch passphrase",
        homeOrganizationId: null,
      }),
    );
    const { token } = await database.transaction((tx) =>
      services.sessions.create(tx, {
        accountId: account.id,
        kind: "full",
        methods: ["password"],
        client: { ip: "127.0.0.1" },
      }),
    );
    let updates = 0;
    const counting = new Proxy(database, {
      get(target, property, receiver) {
        if (property === "update") {
          return (...args: Parameters<typeof database.update>) => {
            updates += 1;
            return target.update(...args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const later = new SessionService({
      database: counting,
      settings: test.settings,
      audit: services.audit,
      clock: () => new Date(Date.now() + 5 * 60_000),
    });
    const resolved = await Promise.all(Array.from({ length: 12 }, () => later.resolve(token)));
    expect(resolved.every((session) => session?.accountId === account.id)).toBe(true);
    expect(updates).toBe(2);
    await later.resolve(token);
    expect(updates).toBe(2);
  });
});
