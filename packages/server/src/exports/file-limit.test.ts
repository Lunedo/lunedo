import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Secret } from "../config/secret.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { testJobContext } from "../testing/jobs.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { exportFixtures } from "./fixtures.testing.js";
import { defaultExportOptions } from "./options.js";
import { PagedExport } from "./paged.js";

vi.mock("./options.js", async (original) => ({
  ...(await original<typeof import("./options.js")>()),
  MAX_FILE_EXPORT_PAGES: 3,
}));

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("the page limit of Word and PDF files", () => {
  let test: TestServices;
  const { setup } = exportFixtures(() => test);
  const { space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "", {
      render: { url: "http://render.test:3000", token: new Secret("t".repeat(40)) },
      renderFetch: (async () =>
        Response.json({
          version: "1.0.0",
          browser: "Chromium 140",
          concurrency: 2,
          running: 0,
          waiting: 0,
          maxBytes: 50 * 1024 * 1024,
          timeoutSeconds: 60,
        })) as unknown as typeof fetch,
    });
    await test.pool.query(
      "insert into instance (id, setup_completed_at) values (1, now()) on conflict do nothing",
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  async function spaceWith(pages: number) {
    const context = await setup();
    const created = await space(context.org.id, context.adminId, { name: `Pages ${pages}` });
    for (let index = 0; index < pages; index += 1) {
      await test.services.tree.create(context.admin, created.id, {
        kind: "page",
        title: `Page ${index}`,
        mode: "live",
        placement: { parentId: null },
      });
    }
    return { context, spaceId: created.id };
  }

  it("names the limit in the counts and refuses Word and PDF above it at the start", async () => {
    const { context, spaceId } = await spaceWith(4);
    expect(await test.services.exports.counts(context.admin, { spaceId })).toMatchObject({ fileLimit: 3 });
    for (const format of ["docx", "pdf"] as const) {
      await expect(
        test.services.exports.start(context.admin, { spaceId }, { format, options: defaultExportOptions }),
      ).rejects.toMatchObject({ code: "tooManyPagesForFile" });
    }
    const error = await test.services.exports
      .start(context.admin, { spaceId }, { format: "docx", options: defaultExportOptions })
      .then(
        () => null,
        (caught: unknown) => caught as Error,
      );
    expect(error?.message).toContain("up to 3 pages");
    expect(error?.message).toContain("HTML or Markdown archive");
    const archive = await test.services.exports.start(
      context.admin,
      { spaceId },
      { format: "html", options: defaultExportOptions },
    );
    expect(archive.state).toBe("queued");
  });

  it("builds a Word file at the limit", async () => {
    const { context, spaceId } = await spaceWith(2);
    expect(await test.services.exports.counts(context.admin, { spaceId })).toMatchObject({ pages: 3 });
    const started = await test.services.exports.start(
      context.admin,
      { spaceId },
      { format: "docx", options: defaultExportOptions },
    );
    await test.services.exports.work(testJobContext("exports.build", { exportId: started.id }));
    expect(await test.services.exports.get(context.admin, started.id)).toMatchObject({ state: "ready" });
  });

  it("fails an export that runs out of memory at once instead of retrying it", async () => {
    const { context, spaceId } = await spaceWith(2);
    const word = vi
      .spyOn(PagedExport.prototype, "word")
      .mockRejectedValue(new RangeError("Array buffer allocation failed"));
    try {
      const started = await test.services.exports.start(
        context.admin,
        { spaceId },
        { format: "docx", options: defaultExportOptions },
      );
      await test.services.exports.work(testJobContext("exports.build", { exportId: started.id }));
      expect(await test.services.exports.get(context.admin, started.id)).toMatchObject({
        state: "failed",
        errorCode: "tooLargeToBuild",
      });
      expect(word).toHaveBeenCalledTimes(1);
    } finally {
      word.mockRestore();
    }
  });
});
