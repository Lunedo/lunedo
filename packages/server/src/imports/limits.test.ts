import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { maxOrganizationSetting } from "./settings.js";
import { createXmlExport } from "./testing/confluence-export.js";
import { largeExport } from "./testing/fixture.js";
import { importHarness } from "./testing/harness.js";

const baseUrl = testDatabaseBaseUrl();
const MEGABYTE = 1024 * 1024;

describe.skipIf(!baseUrl)("Import storage per organization", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);
  const as = (id: string) => accountPrincipal(id);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function withLimit<T>(megabytes: number, run: () => Promise<T>): Promise<T> {
    await test.settings.set(maxOrganizationSetting, {}, "instance", megabytes);
    try {
      return await run();
    } finally {
      await test.settings.clear(maxOrganizationSetting, {}, "instance");
    }
  }

  it("refuses an upload that would exceed the organization's limit and names the usage", async () => {
    const organization = await fixtures.organization();
    const other = await fixtures.organization();
    const uploads = test.services.importUploads;
    await withLimit(2, async () => {
      await uploads.create(as(organization.owner), organization.id, { name: "a.zip", size: MEGABYTE });
      const refused = await uploads
        .create(as(organization.owner), organization.id, { name: "b.zip", size: MEGABYTE + 1 })
        .catch((error: unknown) => error);
      expect(refused).toMatchObject({
        code: "organizationImportLimit",
        details: { maxBytes: 2 * MEGABYTE, usedBytes: MEGABYTE },
      });
      expect(String((refused as Error).message)).toContain("1 of 2 MB");
      await expect(
        uploads.create(as(other.owner), other.id, { name: "c.zip", size: 2 * MEGABYTE }),
      ).resolves.toMatchObject({ size: 2 * MEGABYTE });
    });
  });

  it("counts the uploads of parallel requests only once each", async () => {
    const organization = await fixtures.organization();
    const uploads = test.services.importUploads;
    await withLimit(3, async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, (_, index) =>
          uploads.create(as(organization.owner), organization.id, { name: `${index}.zip`, size: MEGABYTE }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    });
  });

  it("stops reading an export when the staged data reaches the limit", async () => {
    const model = largeExport(3000, 0);
    const archive = createXmlExport(model);
    const measured = await fixtures.organization();
    const unlimited = await harness.prepared(model, {
      organizationId: measured.id,
      admin: measured.owner,
      key: "MEASURE",
      archive,
    });
    const staged = await test.database.execute<{ staged_bytes: string }>(
      sql`select staged_bytes from imports where id = ${unlimited}`,
    );
    expect(Number(staged.rows[0]?.staged_bytes)).toBeGreaterThan(MEGABYTE);
    const organization = await fixtures.organization();
    const limit = Math.ceil(archive.length / MEGABYTE);
    const created = await test.services.imports.create(as(organization.owner), organization.id, {
      source: "confluence-xml",
    });
    await withLimit(limit, async () => {
      const uploadId = await harness.upload(organization.owner, organization.id, archive);
      await test.services.imports.update(as(organization.owner), created.id, {
        file: { kind: "upload", uploadId },
      });
      await harness.drive(created.id);
    });
    const view = await test.services.imports.get(as(organization.owner), created.id);
    expect(view.state).toBe("draft");
    expect(view.errorCode).toBe("organizationImportLimit");
  });

  it("frees the staged data when the file of a draft changes", async () => {
    const organization = await fixtures.organization();
    const id = await harness.prepared(largeExport(20, 0), {
      organizationId: organization.id,
      admin: organization.owner,
      key: "FREED",
    });
    const before = await test.database.execute<{ staged_bytes: string }>(
      sql`select staged_bytes from imports where id = ${id}`,
    );
    expect(Number(before.rows[0]?.staged_bytes)).toBeGreaterThan(0);
    await test.services.imports.update(as(organization.owner), id, { file: null });
    const after = await test.database.execute<{ staged_bytes: string }>(
      sql`select staged_bytes from imports where id = ${id}`,
    );
    expect(Number(after.rows[0]?.staged_bytes)).toBe(0);
  });
});
