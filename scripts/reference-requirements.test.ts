import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { loadEntry, replaceSection, sectionMarkers } from "./docs-reference.ts";
import {
  ACTIONS,
  derive,
  GB,
  GIB,
  type LoadRun,
  parseRequirements,
  type RequirementsSource,
  renderRequirements,
  requirementsReference,
  retainedBackups,
  targetResults,
} from "./reference-requirements.ts";

const root = path.resolve(import.meta.dirname, "..");
const retention = { daily: 7, weekly: 4, monthly: 6, beforeUpdate: 3 };

function run(overrides: Partial<LoadRun> & { p95?: number } = {}): LoadRun {
  const { p95 = 200, ...rest } = overrides;
  return {
    scenario: "peak",
    commit: "fedcba9876543210fedcba9876543210fedcba98",
    startedAt: "2026-10-28T10:00:00Z",
    durationSeconds: 900,
    warmupSeconds: 0,
    disturbed: false,
    actions: Object.fromEntries(
      ACTIONS.map((action) => [action, { count: 100, p50Ms: 80, p95Ms: p95 }]),
    ) as LoadRun["actions"],
    errors: { count: 0, kinds: {} },
    containers: [
      {
        name: "lunedo",
        peakMemoryBytes: GIB,
        averageMemoryBytes: GIB / 2,
        peakCpuPercent: 150,
        averageCpuPercent: 40,
      },
    ],
    totals: { peakMemoryBytes: 1.2 * GIB, peakCpuPercent: 260 },
    machinePeakCpuPercent: 45,
    postgresConnections: { peak: 20, average: 10 },
    jobQueue: { peak: 3, average: 1 },
    ...rest,
  };
}

function data(runs: LoadRun[] = [run(), run()]) {
  return {
    measuredAt: "2026-10-28",
    commit: "0123456789abcdef0123456789abcdef01234567",
    referenceMachine: {
      cpu: "Example CPU",
      vcpus: 4,
      memoryBytes: 8 * GIB,
      diskBytes: 254 * GB,
      storage: "ZFS on one NVMe SSD",
      operatingSystem: "Ubuntu 24.04.5 LTS",
      kernel: "6.8.0",
      docker: "29.0.0",
      compose: "5.0.0",
      postgres: "17.6",
    },
    targets: { pageOpenP95Ms: 500, pageReadableP95Ms: 1500, searchP95Ms: 800, saveP95Ms: 500, errors: 0 },
    sizes: [
      {
        name: "small",
        people: 25,
        pages: 2000,
        spaces: 10,
        attachmentBytes: 2 * GB,
        concurrentPeople: 5,
        startSeconds: 12.5,
        footprint: {
          imageBytes: 0.5 * GB,
          databaseBytes: 1 * GB,
          fileStorageBytes: 2 * GB,
          backupBytes: 2.5 * GB,
          backupSeconds: 90,
          restoreSeconds: 120,
        },
        idle: [{ name: "lunedo", memoryBytes: 400 * 1024 ** 2, cpuPercent: 1 }],
        searchIndexSeconds: { p50: 1.5, p95: 3 },
        loadRuns: runs,
        bulk: [
          {
            workers: 4,
            pagesPerMinute: 263,
            versionsPerMinute: 1310,
            requestsPerSecond: 52,
            uploadMegabytesPerSecond: 4.4,
            machineCpuPercent: 80,
          },
        ],
      },
    ],
  };
}

function only<T>(items: readonly T[]): T {
  const [item] = items;
  assert.ok(item);
  return item;
}

function source(value: unknown): RequirementsSource {
  return { data: value, retention };
}

describe("parseRequirements", () => {
  it("accepts complete measurements", () => {
    assert.equal(parseRequirements(data()).sizes[0]?.loadRuns.length, 2);
  });

  it("names the missing or wrong value", () => {
    const missing = data() as Record<string, unknown>;
    delete missing.commit;
    assert.throws(() => parseRequirements(missing), /commit must be a non-empty string/);
    assert.throws(() => parseRequirements({ ...data(), commit: "main" }), /commit must be a commit hash/);
    const negative = data();
    only(negative.sizes).footprint.databaseBytes = -1;
    assert.throws(() => parseRequirements(negative), /sizes\[0\]\.footprint\.databaseBytes must be a number/);
    const { search: _search, ...withoutSearch } = run().actions;
    const action = data([{ ...run(), actions: withoutSearch as LoadRun["actions"] }, run()]);
    assert.throws(() => parseRequirements(action), /loadRuns\[0\]\.actions\.search must be an object/);
  });

  it("refuses a size without two undisturbed load runs", () => {
    assert.throws(
      () => parseRequirements(data([run(), run({ disturbed: true })])),
      /size small must be measured with at least two undisturbed load runs/,
    );
  });
});

describe("scenarios", () => {
  const typical = (overrides: Partial<LoadRun> & { p95?: number } = {}) =>
    run({ scenario: "typical", ...overrides });

  it("judge a size by its typical runs and keep peak as headroom", () => {
    const parsed = parseRequirements(data([run({ p95: 900 }), run({ p95: 900 }), typical(), typical()]));
    const size = only(parsed.sizes);
    assert.ok(targetResults(size, parsed.targets).every((target) => target.met));
    assert.equal(targetResults(size, parsed.targets, "peak")[0]?.met, false);
    assert.equal(derive(size, parsed, 20).recommendedCpus, 3);
  });

  it("take the hardware from typical when it was measured", () => {
    const parsed = parseRequirements(
      data([
        run({ machinePeakCpuPercent: 97.5 }),
        run({ machinePeakCpuPercent: 97.5 }),
        typical(),
        typical(),
      ]),
    );
    assert.equal(derive(only(parsed.sizes), parsed, 20).minimumCpus, 2);
  });

  it("recommend at least the CPU the peak scenario used when typical needs less", () => {
    const parsed = parseRequirements(
      data([
        run({ machinePeakCpuPercent: 59.3 }),
        run({ machinePeakCpuPercent: 57.4 }),
        typical({ machinePeakCpuPercent: 28.2 }),
        typical({ machinePeakCpuPercent: 27 }),
      ]),
    );
    const values = derive(only(parsed.sizes), parsed, 20);
    assert.equal(values.minimumCpus, 2);
    assert.equal(values.recommendedCpus, 3);
  });

  it("judge a size with fewer than two typical runs by peak", () => {
    const parsed = parseRequirements(data([run({ p95: 900 }), run(), typical()]));
    assert.equal(targetResults(only(parsed.sizes), parsed.targets)[0]?.met, false);
  });

  it("refuse an unknown scenario or a run without commit", () => {
    assert.throws(
      () => parseRequirements(data([{ ...run(), scenario: "busy" as LoadRun["scenario"] }, run()])),
      /loadRuns\[0\]\.scenario must be typical or peak/,
    );
    assert.throws(
      () => parseRequirements(data([{ ...run(), commit: "main" }, run()])),
      /loadRuns\[0\]\.commit must be a commit hash/,
    );
  });
});

describe("derived requirements", () => {
  it("round the peak up for the minimum and multiply it for the recommendation", () => {
    const parsed = parseRequirements(data());
    const values = derive(only(parsed.sizes), parsed, retainedBackups(retention));
    assert.deepEqual(values, {
      minimumCpus: 2,
      minimumMemoryGiB: 2,
      minimumDiskGB: 6,
      recommendedCpus: 3,
      recommendedMemoryGiB: 2,
      diskBackupsElsewhereGB: 8,
      diskBackupsHereGB: 70,
    });
  });

  it("never recommend more CPU than was measured, and none when a target was missed", () => {
    const busy = parseRequirements(data([run({ machinePeakCpuPercent: 97.5 }), run()]));
    assert.equal(derive(only(busy.sizes), busy, 20).recommendedCpus, 4);
    const slow = parseRequirements(data([run({ p95: 900 }), run()]));
    assert.equal(derive(only(slow.sizes), slow, 20).recommendedCpus, null);
  });

  it("write large numbers with separators", () => {
    const text = renderRequirements(
      source(data([run({ errors: { count: 58616, kinds: { "HTTP 500": 58616 } } }), run()])),
    );
    assert.match(text, /\| small \| peak \| Errors \| 0 \| 58,616 \| no \|/);
  });

  it("ignore disturbed runs", () => {
    const parsed = parseRequirements(
      data([run(), run(), run({ disturbed: true, p95: 5000, errors: { count: 9, kinds: { timeout: 9 } } })]),
    );
    assert.ok(targetResults(only(parsed.sizes), parsed.targets).every((target) => target.met));
  });

  it("report each missed target with the worst run", () => {
    const parsed = parseRequirements(
      data([run({ p95: 650, errors: { count: 2, kinds: { "HTTP 502": 2 } } }), run()]),
    );
    const results = targetResults(only(parsed.sizes), parsed.targets);
    assert.deepEqual(
      results.map((target) => [target.name, target.measured, target.met]),
      [
        ["Open a page, API (p95)", "650 ms", false],
        ["Open a page, readable (p95)", "650 ms", true],
        ["Search (p95)", "650 ms", true],
        ["Save (p95)", "650 ms", false],
        ["Errors", "2", false],
      ],
    );
  });
});

describe("rendered section", () => {
  it("shows the machine, the date, the commit and every size", () => {
    const text = renderRequirements(source(data()));
    assert.match(text, /^Measured on a reference machine with 4 vCPU \(Example CPU\)/);
    assert.match(text, /of disk \(ZFS on one NVMe SSD\), running/);
    assert.match(text, /Size, backups and start times were measured on 2026-10-28 with commit `01234567`/);
    assert.match(text, /\| small \| peak \| 2 \| 2026-10-28 \| `fedcba98` \|/);
    assert.match(
      text,
      /without TLS and without a reverse proxy, with synthetic content and the default limits/,
    );
    assert.match(text, /\| small \| 2 vCPU \| 2 GiB \| 6 GB \| 3 vCPU \| 2 GiB \| 8 GB \| 70 GB \|/);
    assert.match(text, /counts the 20 backups that the default retention keeps/);
    assert.match(text, /\| small \| 4 \| 263 \| 1,310 \| 52 \| 4\.4 MB\/s \| 80 % \|/);
    assert.match(text, /RAM from the Lunedo and PostgreSQL containers/);
    assert.match(text, /\| small \| peak \| Errors \| 0 \| 0 \| yes \|/);
  });

  it("names both scenarios with their assumptions and the commit of each scenario's runs", () => {
    const typical = () =>
      run({
        scenario: "typical",
        commit: "abcdef0123456789abcdef0123456789abcdef01",
        startedAt: "2026-11-01T08:00:00Z",
        warmupSeconds: 240,
      });
    const text = renderRequirements(source(data([run(), run(), typical(), typical()])));
    assert.match(text, /\| typical \| 30 to 90 seconds, 60 on average \| 70 % \| 15 % \| 2 % \| 13 % \|/);
    assert.match(text, /\| peak \| 7 to 36 seconds, 18 on average \| 70 % \| 15 % \| 10 % \| 5 % \|/);
    assert.match(text, /The targets apply to \*\*typical\*\*/);
    assert.match(text, /\| small \| typical \| 2 \| 2026-11-01 \| `abcdef01` \| 4 min \|/);
    assert.match(text, /\| small \| peak \| 2 \| 2026-10-28 \| `fedcba98` \| nothing \|/);
  });

  it("says when the targets were missed instead of recommending CPU", () => {
    const text = renderRequirements(source(data([run({ p95: 900 }), run()])));
    assert.match(text, /more than 4 vCPU; the targets were missed on the reference machine/);
    assert.match(text, /The minimum of small is what the reference machine used while it missed the targets/);
    assert.doesNotMatch(renderRequirements(source(data())), /while it missed the targets/);
  });

  it("replaces only the marked section of a hand-written page", () => {
    const [start, end] = sectionMarkers("measured-requirements");
    const reference = {
      page: "admin/requirements.md",
      sources: ["a.json"],
      section: "measured-requirements",
    };
    const before = `# Requirements\n\nHand-written.\n\n${start}\nold\n${end}\n\nAfter.\n`;
    const after = replaceSection(before, reference, "new");
    assert.match(
      after,
      /^# Requirements\n\nHand-written\.\n\n<!-- generated:measured-requirements -->\n\nThis section is generated from `a\.json`/,
    );
    assert.match(after, /\n\nnew\n\n<!-- \/generated:measured-requirements -->\n\nAfter\.\n$/);
    assert.equal(replaceSection(after, reference, "new"), after);
    assert.throws(
      () => replaceSection("# Requirements\n", reference, "new"),
      /needs exactly one pair of the markers/,
    );
    assert.throws(
      () => replaceSection(`${start}\n${end}\n${start}\n${end}\n`, reference, "new"),
      /needs exactly one pair of the markers/,
    );
  });

  it("reads the default retention from the backup settings", async () => {
    const loaded = (await loadEntry(
      root,
      "requirements-test",
      requirementsReference.entry,
    )) as RequirementsSource;
    assert.deepEqual(loaded.retention, retention);
    assert.equal(retainedBackups(loaded.retention), 20);
  });

  it("is the section the requirements page links to", () => {
    const page = readFileSync(path.join(root, "docs", "admin", "requirements.md"), "utf8");
    assert.match(page, /\| CPU and RAM \| .*\(#measured-requirements\)/);
    assert.match(page, /## Measured requirements\n\n<!-- generated:measured-requirements -->/);
    assert.doesNotMatch(page.split("## Measured requirements")[0] ?? "", /\d+ (GiB|GB) of RAM|\d+ vCPU/);
  });
});
