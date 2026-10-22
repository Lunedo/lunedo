import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { DEFAULT_UPDATE_CHECK_URL } from "../config/definitions.js";
import { createLogger, type Logger } from "../logging/logger.js";
import { outboundPolicy } from "../outbound/guarded-request.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeHandler, type RunningFake, serveFake } from "../testing/fakes/http.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { Release } from "./changelog.js";
import { updateCheckSetting } from "./settings.js";
import {
  displayedUrl,
  downloadVersionFile,
  IMAGE_REPOSITORY,
  UpdateCheckError,
  UpdateCheckService,
  updateCommands,
} from "./update-check.js";

const baseUrl = testDatabaseBaseUrl();
const localPolicy = outboundPolicy(["127.0.0.1/32"]);

function release(version: string, notes: Partial<Release["notes"]> = {}): Release {
  return {
    version,
    date: "2026-11-02",
    minimumUpdateFrom: null,
    url: `https://github.com/lunedo/lunedo/releases/tag/v${version}`,
    notes: { new: [], improved: [], fixed: [], breaking: [], manualSteps: [], ...notes },
  };
}

describe("updateCommands", () => {
  it("builds the commands from the installation method and a release version only", () => {
    expect(updateCommands("script", "/opt/lunedo", "1.5.0")).toEqual({
      method: "script",
      steps: [
        { kind: "command", text: "cd /opt/lunedo" },
        { kind: "command", text: "./lunedo update 1.5.0" },
      ],
    });
    const compose = updateCommands("compose", undefined, "1.5.0");
    expect(compose.steps.map((step) => step.text)).toContain(
      `Set the image of the lunedo service to ${IMAGE_REPOSITORY}:1.5.0.`,
    );
    expect(updateCommands(undefined, undefined, "1.5.0").method).toBe("unknown");
  });
});

describe("update commands and the shown address", () => {
  it("quotes an installation directory with spaces or quotes", () => {
    expect(updateCommands("script", "/home/ops/Lunedo Wiki", "1.5.0").steps[0]).toEqual({
      kind: "command",
      text: "cd '/home/ops/Lunedo Wiki'",
    });
    expect(updateCommands("compose", "/srv/it's here", "1.5.0").steps[0]?.text).toBe(
      "cd '/srv/it'\\''s here'",
    );
    expect(updateCommands("script", "/opt/lunedo", "1.5.0").steps[0]?.text).toBe("cd /opt/lunedo");
  });

  it("shows only the scheme, host and path of the version file address", () => {
    expect(displayedUrl("https://mirror.example.org:8443/lunedo/versions.json")).toBe(
      "https://mirror.example.org:8443/lunedo/versions.json",
    );
    expect(displayedUrl("https://user:secret@mirror.example.org/v.json?token=abc#x")).toBe(
      "https://mirror.example.org/v.json",
    );
  });
});

describe("downloadVersionFile", () => {
  let server: RunningFake | undefined;
  let handler: FakeHandler;

  beforeAll(async () => {
    server = await serveFake((request) => handler(request));
  });

  afterAll(async () => {
    await server?.close();
  });

  const url = (file = "/lunedo-versions.json") => `${server?.url ?? ""}${file}`;

  it("follows redirects like the ones of GitHub release downloads and reads the releases", async () => {
    handler = (request) =>
      request.url.pathname === "/latest"
        ? { status: 302, headers: { location: "/assets/lunedo-versions.json" } }
        : { status: 200, body: { schema: 1, releases: [release("1.5.0")] } };
    expect((await downloadVersionFile(localPolicy, url("/latest"))).map((entry) => entry.version)).toEqual([
      "1.5.0",
    ]);
  });

  it("ignores and logs entries without a strict release version", async () => {
    handler = () => ({
      status: 200,
      body: { schema: 1, releases: [release("v1.6.0"), release("1.5.0"), release("1.7.0-beta")] },
    });
    const warnings: unknown[] = [];
    const logger = { warn: (...args: unknown[]) => warnings.push(args) } as unknown as Logger;
    expect((await downloadVersionFile(localPolicy, url(), logger)).map((entry) => entry.version)).toEqual([
      "1.5.0",
    ]);
    expect(warnings).toHaveLength(1);
  });

  it("names why the check failed", async () => {
    const reason = async (address: string, policy = localPolicy) =>
      downloadVersionFile(policy, address).then(
        () => null,
        (error: unknown) => (error instanceof UpdateCheckError ? error.reason : String(error)),
      );
    handler = () => ({ status: 404, body: { message: "Not Found" } });
    expect(await reason(url())).toBe("httpStatus");
    handler = () => ({ status: 200, body: "not a version file" });
    expect(await reason(url())).toBe("invalidFile");
    handler = () => ({ status: 200, body: { schema: 2, releases: [] } });
    expect(await reason(url())).toBe("invalidFile");
    handler = () => ({
      status: 200,
      body: { schema: 1, releases: [], padding: "x".repeat(3 * 1024 * 1024) },
    });
    expect(await reason(url())).toBe("tooLarge");
    handler = () => ({ status: 302, headers: { location: "/loop" } });
    expect(await reason(url())).toBe("tooManyRedirects");
    expect(await reason(url(), outboundPolicy([]))).toBe("blockedAddress");
    expect(await reason("http://127.0.0.1:9/lunedo-versions.json")).toBe("unreachable");
  });
});

describe.skipIf(!baseUrl)("UpdateCheckService", () => {
  let test: TestServices;
  let downloads: number;
  let answer: () => Promise<Release[]>;
  let running: string;
  let check: boolean;
  const warnings: string[] = [];
  const fixtures = spaceFixtures(() => test);

  const logger = createLogger({
    service: "test",
    level: "warn",
    destination: new Writable({
      write(chunk: Buffer, _encoding, callback) {
        warnings.push(String(JSON.parse(chunk.toString()).message));
        callback();
      },
    }),
  });

  const service = () =>
    new UpdateCheckService({
      database: test.database,
      settings: test.settings,
      notifications: test.services.notifications,
      policy: localPolicy,
      logger,
      environment: {
        check,
        url: DEFAULT_UPDATE_CHECK_URL,
        installMethod: "script",
        installDir: "/opt/lunedo",
        changelogFile: "CHANGELOG.md",
      },
      running: () => running,
      download: async () => {
        downloads += 1;
        return answer();
      },
    });

  async function notifications(): Promise<{ type: string; params: Record<string, unknown> }[]> {
    const result = await test.database.execute<{ type: string; params: Record<string, unknown> }>(
      sql`select type, params from notifications where type = 'operations.updateAvailable' order by created_at`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    const owner = await fixtures.account({ name: "Owner" });
    await test.pool.query(
      "insert into instance (id, owner_account_id) values (1, $1) on conflict (id) do update set owner_account_id = $1",
      [owner],
    );
  });

  afterAll(async () => {
    await test?.close();
  });

  beforeEach(async () => {
    downloads = 0;
    running = "1.4.2";
    check = true;
    warnings.length = 0;
    answer = async () => [release("1.4.2"), release("1.5.0", { breaking: ["The metrics port moved."] })];
    await test.pool.query("delete from update_check_state");
    await test.pool.query("delete from notifications where type = 'operations.updateAvailable'");
    await test.settings.set(updateCheckSetting, {}, "instance", true);
  });

  afterEach(async () => {
    await test.settings.clear(updateCheckSetting, {}, "instance");
  });

  it("shows the available version with its notes and commands and notifies administrators once", async () => {
    const status = await service().check();
    expect(status).toMatchObject({
      enabled: true,
      succeeded: true,
      failure: null,
      running: "1.4.2",
      latest: "1.5.0",
      commands: {
        method: "script",
        steps: [{ text: "cd /opt/lunedo" }, { text: "./lunedo update 1.5.0" }],
      },
    });
    expect(status.available.map((entry) => entry.version)).toEqual(["1.5.0"]);
    expect(await service().updateAvailable()).toBe(true);
    await service().check();
    expect(await notifications()).toEqual([
      {
        type: "operations.updateAvailable",
        params: {
          version: "1.5.0",
          current: "1.4.2",
          breaking: true,
          link: "https://wiki.example.org/settings/instance/updates",
        },
      },
    ]);

    answer = async () => [release("1.5.0"), release("1.6.0")];
    await service().check();
    expect((await notifications()).map((entry) => entry.params.version)).toEqual(["1.6.0"]);
  });

  it("makes no request at all when the environment or the setting turns it off", async () => {
    check = false;
    expect(await service().check()).toMatchObject({
      enabled: false,
      disabledBy: "environment",
      latest: null,
    });
    expect(await service().updateAvailable()).toBeNull();
    check = true;
    await test.settings.set(updateCheckSetting, {}, "instance", false);
    expect(await service().check()).toMatchObject({ enabled: false, disabledBy: "setting" });
    expect(downloads).toBe(0);
  });

  it("records a failed check with its reason and logs one warning", async () => {
    answer = async () => {
      throw new UpdateCheckError("httpStatus", "The server answered with status 404");
    };
    const status = await service().check();
    expect(status).toMatchObject({ succeeded: false, failure: "httpStatus", latest: null, commands: null });
    expect(status.checkedAt).toBeInstanceOf(Date);
    expect(warnings).toEqual(["The update check failed"]);
    expect(await notifications()).toEqual([]);
  });

  it("does not notify builds without a release version but still shows the newest release", async () => {
    running = "0a1b2c3";
    const status = await service().check();
    expect(status).toMatchObject({ runningIsRelease: false, latest: "1.5.0" });
    expect(await service().updateAvailable()).toBe(false);
    expect(await notifications()).toEqual([]);
  });

  it("notifies only once when two workers check at the same moment", async () => {
    await Promise.all([service().check(), service().check()]);
    expect(await notifications()).toHaveLength(1);
  });
});
