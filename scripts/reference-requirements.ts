import { defineReference, table } from "./docs-reference.ts";

const DATA = "docs/data/requirements.json";
const BACKUP_DEFAULTS = "packages/server/src/backup/configuration.ts";

export const GIB = 1024 ** 3;
export const GB = 1000 ** 3;
export const RAM_FACTOR = 1.5;
export const CPU_FACTOR = 1.5;
export const DISK_HEADROOM = 1.3;

export const ACTIONS = ["pageOpen", "pageReadable", "search", "save", "forYou"] as const;
export type Action = (typeof ACTIONS)[number];

export const SCENARIOS = ["typical", "peak"] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface Timing {
  readonly count: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface ContainerUsage {
  readonly name: string;
  readonly peakMemoryBytes: number;
  readonly averageMemoryBytes: number;
  readonly peakCpuPercent: number;
  readonly averageCpuPercent: number;
}

export interface LoadRun {
  readonly scenario: Scenario;
  readonly commit: string;
  readonly startedAt: string;
  readonly durationSeconds: number;
  readonly warmupSeconds: number;
  readonly disturbed: boolean;
  readonly actions: Readonly<Record<Action, Timing>>;
  readonly errors: { readonly count: number; readonly kinds: Readonly<Record<string, number>> };
  readonly containers: readonly ContainerUsage[];
  readonly totals: { readonly peakMemoryBytes: number; readonly peakCpuPercent: number };
  readonly machinePeakCpuPercent: number;
  readonly postgresConnections: { readonly peak: number; readonly average: number };
  readonly jobQueue: { readonly peak: number; readonly average: number };
}

export interface SizeResult {
  readonly name: string;
  readonly people: number;
  readonly pages: number;
  readonly spaces: number;
  readonly attachmentBytes: number;
  readonly concurrentPeople: number;
  readonly footprint: {
    readonly imageBytes: number;
    readonly databaseBytes: number;
    readonly fileStorageBytes: number;
    readonly backupBytes: number;
    readonly backupSeconds: number;
    readonly restoreSeconds: number;
  };
  readonly idle: readonly {
    readonly name: string;
    readonly memoryBytes: number;
    readonly cpuPercent: number;
  }[];
  readonly startSeconds: number;
  readonly searchIndexSeconds: { readonly p50: number; readonly p95: number };
  readonly loadRuns: readonly LoadRun[];
  readonly bulk: readonly BulkWrite[];
}

export interface BulkWrite {
  readonly workers: number;
  readonly pagesPerMinute: number;
  readonly versionsPerMinute: number;
  readonly requestsPerSecond: number;
  readonly uploadMegabytesPerSecond: number;
  readonly machineCpuPercent: number;
}

export interface Requirements {
  readonly measuredAt: string;
  readonly commit: string;
  readonly referenceMachine: {
    readonly cpu: string;
    readonly vcpus: number;
    readonly memoryBytes: number;
    readonly diskBytes: number;
    readonly storage: string;
    readonly operatingSystem: string;
    readonly kernel: string;
    readonly docker: string;
    readonly compose: string;
    readonly postgres: string;
  };
  readonly targets: {
    readonly pageOpenP95Ms: number;
    readonly pageReadableP95Ms: number;
    readonly searchP95Ms: number;
    readonly saveP95Ms: number;
    readonly errors: number;
  };
  readonly sizes: readonly SizeResult[];
}

export interface RequirementsSource {
  readonly data: unknown;
  readonly retention: Readonly<Record<string, number>>;
}

function fail(where: string, expected: string): never {
  throw new Error(`${DATA}: ${where} must be ${expected}`);
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(where, "an object");
  return value as Record<string, unknown>;
}

function array(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) fail(where, "a non-empty array");
  return value;
}

function number(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    fail(where, "a number of at least 0");
  return value;
}

function text(value: unknown, where: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(where, "a non-empty string");
  return value;
}

function flag(value: unknown, where: string): boolean {
  if (typeof value !== "boolean") fail(where, "true or false");
  return value;
}

function numbers<K extends string>(value: unknown, where: string, keys: readonly K[]): Record<K, number> {
  const source = object(value, where);
  return Object.fromEntries(keys.map((key) => [key, number(source[key], `${where}.${key}`)])) as Record<
    K,
    number
  >;
}

function timing(value: unknown, where: string): Timing {
  const result = numbers(value, where, ["count", "p50Ms", "p95Ms"]);
  if (result.count < 1) fail(`${where}.count`, "at least 1");
  if (result.p50Ms > result.p95Ms) fail(`${where}.p50Ms`, "at most p95Ms");
  return result;
}

function container(value: unknown, where: string): ContainerUsage {
  const source = object(value, where);
  return {
    name: text(source.name, `${where}.name`),
    ...numbers(source, where, [
      "peakMemoryBytes",
      "averageMemoryBytes",
      "peakCpuPercent",
      "averageCpuPercent",
    ]),
  };
}

function loadRun(value: unknown, where: string): LoadRun {
  const source = object(value, where);
  const actions = object(source.actions, `${where}.actions`);
  const errors = object(source.errors, `${where}.errors`);
  const kinds = object(errors.kinds, `${where}.errors.kinds`);
  const scenario = text(source.scenario, `${where}.scenario`);
  if (!(SCENARIOS as readonly string[]).includes(scenario)) fail(`${where}.scenario`, "typical or peak");
  const commit = text(source.commit, `${where}.commit`);
  if (!/^[0-9a-f]{7,40}$/.test(commit)) fail(`${where}.commit`, "a commit hash");
  return {
    scenario: scenario as Scenario,
    commit,
    startedAt: text(source.startedAt, `${where}.startedAt`),
    durationSeconds: number(source.durationSeconds, `${where}.durationSeconds`),
    warmupSeconds:
      source.warmupSeconds === undefined ? 0 : number(source.warmupSeconds, `${where}.warmupSeconds`),
    disturbed: flag(source.disturbed, `${where}.disturbed`),
    actions: Object.fromEntries(
      ACTIONS.map((action) => [action, timing(actions[action], `${where}.actions.${action}`)]),
    ) as Record<Action, Timing>,
    errors: {
      count: number(errors.count, `${where}.errors.count`),
      kinds: Object.fromEntries(
        Object.entries(kinds).map(([kind, count]) => [kind, number(count, `${where}.errors.kinds.${kind}`)]),
      ),
    },
    containers: array(source.containers, `${where}.containers`).map((entry, index) =>
      container(entry, `${where}.containers[${index}]`),
    ),
    totals: numbers(source.totals, `${where}.totals`, ["peakMemoryBytes", "peakCpuPercent"]),
    machinePeakCpuPercent: number(source.machinePeakCpuPercent, `${where}.machinePeakCpuPercent`),
    postgresConnections: numbers(source.postgresConnections, `${where}.postgresConnections`, [
      "peak",
      "average",
    ]),
    jobQueue: numbers(source.jobQueue, `${where}.jobQueue`, ["peak", "average"]),
  };
}

function size(value: unknown, where: string): SizeResult {
  const source = object(value, where);
  return {
    name: text(source.name, `${where}.name`),
    ...numbers(source, where, [
      "people",
      "pages",
      "spaces",
      "attachmentBytes",
      "concurrentPeople",
      "startSeconds",
    ]),
    footprint: numbers(source.footprint, `${where}.footprint`, [
      "imageBytes",
      "databaseBytes",
      "fileStorageBytes",
      "backupBytes",
      "backupSeconds",
      "restoreSeconds",
    ]),
    idle: array(source.idle, `${where}.idle`).map((entry, index) => {
      const idle = object(entry, `${where}.idle[${index}]`);
      return {
        name: text(idle.name, `${where}.idle[${index}].name`),
        ...numbers(idle, `${where}.idle[${index}]`, ["memoryBytes", "cpuPercent"]),
      };
    }),
    searchIndexSeconds: numbers(source.searchIndexSeconds, `${where}.searchIndexSeconds`, ["p50", "p95"]),
    loadRuns: array(source.loadRuns, `${where}.loadRuns`).map((run, index) =>
      loadRun(run, `${where}.loadRuns[${index}]`),
    ),
    bulk: array(source.bulk, `${where}.bulk`).map((entry, index) =>
      numbers(entry, `${where}.bulk[${index}]`, [
        "workers",
        "pagesPerMinute",
        "versionsPerMinute",
        "requestsPerSecond",
        "uploadMegabytesPerSecond",
        "machineCpuPercent",
      ]),
    ),
  };
}

export function parseRequirements(value: unknown): Requirements {
  const source = object(value, "the file");
  const machine = object(source.referenceMachine, "referenceMachine");
  const measuredAt = text(source.measuredAt, "measuredAt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(measuredAt)) fail("measuredAt", "a date like 2026-10-28");
  const commit = text(source.commit, "commit");
  if (!/^[0-9a-f]{7,40}$/.test(commit)) fail("commit", "a commit hash");
  const sizes = array(source.sizes, "sizes").map((entry, index) => size(entry, `sizes[${index}]`));
  for (const entry of sizes) {
    if (counted(runsOf(entry, primaryScenario(entry))).length < 2) {
      fail(`size ${entry.name}`, "measured with at least two undisturbed load runs");
    }
  }
  return {
    measuredAt,
    commit,
    referenceMachine: {
      cpu: text(machine.cpu, "referenceMachine.cpu"),
      storage: text(machine.storage, "referenceMachine.storage"),
      operatingSystem: text(machine.operatingSystem, "referenceMachine.operatingSystem"),
      kernel: text(machine.kernel, "referenceMachine.kernel"),
      docker: text(machine.docker, "referenceMachine.docker"),
      compose: text(machine.compose, "referenceMachine.compose"),
      postgres: text(machine.postgres, "referenceMachine.postgres"),
      ...numbers(machine, "referenceMachine", ["vcpus", "memoryBytes", "diskBytes"]),
    },
    targets: numbers(source.targets, "targets", [
      "pageOpenP95Ms",
      "pageReadableP95Ms",
      "searchP95Ms",
      "saveP95Ms",
      "errors",
    ]),
    sizes,
  };
}

function counted(runs: readonly LoadRun[]): readonly LoadRun[] {
  return runs.filter((run) => !run.disturbed);
}

export function runsOf(size: SizeResult, scenario: Scenario): readonly LoadRun[] {
  return size.loadRuns.filter((run) => run.scenario === scenario);
}

export function primaryScenario(size: SizeResult): Scenario {
  return counted(runsOf(size, "typical")).length >= 2 ? "typical" : "peak";
}

function scenariosOf(size: SizeResult): Scenario[] {
  return SCENARIOS.filter((scenario) => counted(runsOf(size, scenario)).length > 0);
}

function worst(runs: readonly LoadRun[], action: Action): number {
  return Math.max(...counted(runs).map((run) => run.actions[action].p95Ms));
}

function median(runs: readonly LoadRun[], action: Action, key: "p50Ms" | "p95Ms"): number {
  const values = counted(runs)
    .map((run) => run.actions[action][key])
    .sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] ?? 0)
    : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2;
}

export interface TargetResult {
  readonly name: string;
  readonly limit: string;
  readonly measured: string;
  readonly met: boolean;
}

export function targetResults(
  size: SizeResult,
  targets: Requirements["targets"],
  scenario: Scenario = primaryScenario(size),
): TargetResult[] {
  const runs = runsOf(size, scenario);
  const errors = counted(runs).reduce((sum, run) => sum + run.errors.count, 0);
  const timed = (name: string, action: Action, limit: number): TargetResult => {
    const measured = worst(runs, action);
    return { name, limit: `below ${duration(limit)}`, measured: duration(measured), met: measured < limit };
  };
  return [
    timed("Open a page, API (p95)", "pageOpen", targets.pageOpenP95Ms),
    timed("Open a page, readable (p95)", "pageReadable", targets.pageReadableP95Ms),
    timed("Search (p95)", "search", targets.searchP95Ms),
    timed("Save (p95)", "save", targets.saveP95Ms),
    {
      name: "Errors",
      limit: integer(targets.errors),
      measured: integer(errors),
      met: errors <= targets.errors,
    },
  ];
}

export interface Derived {
  readonly minimumCpus: number;
  readonly minimumMemoryGiB: number;
  readonly minimumDiskGB: number;
  readonly recommendedCpus: number | null;
  readonly recommendedMemoryGiB: number;
  readonly diskBackupsElsewhereGB: number;
  readonly diskBackupsHereGB: number;
}

export function retainedBackups(retention: Readonly<Record<string, number>>): number {
  return Object.values(retention).reduce((sum, count) => sum + count, 0);
}

export function derive(size: SizeResult, data: Requirements, backups: number): Derived {
  const runs = counted(runsOf(size, primaryScenario(size)));
  const peakMemory = Math.max(...runs.map((run) => run.totals.peakMemoryBytes));
  const peakCores =
    (Math.max(...runs.map((run) => run.machinePeakCpuPercent)) / 100) * data.referenceMachine.vcpus;
  const footprint = size.footprint;
  const stored = footprint.imageBytes + footprint.databaseBytes + footprint.fileStorageBytes;
  const met = targetResults(size, data.targets).every((target) => target.met);
  const minimumCpus = Math.max(1, Math.ceil(peakCores));
  const busiestRuns = counted(runsOf(size, "peak"));
  const busiestCores = busiestRuns.length
    ? (Math.max(...busiestRuns.map((run) => run.machinePeakCpuPercent)) / 100) * data.referenceMachine.vcpus
    : 0;
  return {
    minimumCpus,
    minimumMemoryGiB: Math.max(1, Math.ceil(peakMemory / GIB)),
    minimumDiskGB: Math.ceil((stored + footprint.backupBytes) / GB),
    recommendedCpus: met
      ? Math.min(
          data.referenceMachine.vcpus,
          Math.max(2, minimumCpus, Math.ceil(peakCores * CPU_FACTOR), Math.ceil(busiestCores)),
        )
      : null,
    recommendedMemoryGiB: Math.ceil((peakMemory * RAM_FACTOR) / GIB),
    diskBackupsElsewhereGB: Math.ceil(((stored + footprint.backupBytes) * DISK_HEADROOM) / GB),
    diskBackupsHereGB: Math.ceil(((stored + footprint.backupBytes * backups) * DISK_HEADROOM) / GB),
  };
}

export function duration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function bytes(value: number): string {
  if (value >= GB) return `${(value / GB).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(value / 1000 ** 2))} MB`;
}

function memory(value: number): string {
  return value >= GIB ? `${(value / GIB).toFixed(1)} GiB` : `${Math.round(value / 1024 ** 2)} MiB`;
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function missedNote(names: string[]): string[] {
  if (names.length === 0) return [];
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return [
    `The minimum of ${list} is what the reference machine used while it missed the targets, not what keeps ${names.length === 1 ? "this size" : "these sizes"} usable.`,
  ];
}

function cpus(count: number | null, data: Requirements): string {
  if (count === null)
    return `more than ${data.referenceMachine.vcpus} vCPU; the targets were missed on the reference machine`;
  return `${count} vCPU`;
}

export function renderRequirements(source: RequirementsSource): string {
  const data = parseRequirements(source.data);
  const machine = data.referenceMachine;
  const backups = retainedBackups(source.retention);
  const derived = data.sizes.map((entry) => ({ size: entry, values: derive(entry, data, backups) }));
  const minutes = Math.round(
    Math.max(...data.sizes.flatMap((entry) => entry.loadRuns.map((run) => run.durationSeconds))) / 60,
  );
  return [
    `Measured on a reference machine with ${machine.vcpus} vCPU (${machine.cpu}), ${memory(machine.memoryBytes)} of RAM and ${bytes(machine.diskBytes)} of disk (${machine.storage}), running ${machine.operatingSystem} with kernel ${machine.kernel}, Docker ${machine.docker}, Docker Compose ${machine.compose} and PostgreSQL ${machine.postgres}. Each size ran on a fresh installation from the setup script, without TLS and without a reverse proxy, with synthetic content and the default limits. Size, backups and start times were measured on ${data.measuredAt} with commit \`${data.commit.slice(0, 8)}\`. The load came from one computer, which sent the requests of each person from a client address of its own, in load runs of ${minutes} minutes.`,
    "### Scenarios",
    "The load runs follow one of two scenarios. Both are assumptions about how people use a wiki, not measured use. In both, five of the people active at the same time edit the same page together.",
    table(
      [
        "Scenario",
        "Wait between two actions",
        "Open a page",
        "Search",
        "Edit and publish",
        "Notifications and For you",
      ],
      [
        ["typical", "30 to 90 seconds, 60 on average", "70 %", "15 %", "2 %", "13 %"],
        ["peak", "7 to 36 seconds, 18 on average", "70 %", "15 %", "10 %", "5 %"],
      ],
    ),
    "The targets apply to **typical**; **peak** shows how much room is left. A size measured only with peak is judged by peak, and its hardware comes from peak. Response times of the first minutes of a run, while the people start and the load generator opens its connections, are not counted where the table says so; errors always are.",
    table(
      ["Size", "Scenario", "Load runs", "Measured on", "Commit", "Not counted at the start"],
      data.sizes.flatMap((entry) =>
        scenariosOf(entry).map((scenario) => {
          const runs = counted(runsOf(entry, scenario));
          const dates = [...new Set(runs.map((run) => run.startedAt.slice(0, 10)))].sort();
          const commits = [...new Set(runs.map((run) => `\`${run.commit.slice(0, 8)}\``))];
          const warmup = Math.max(...runs.map((run) => run.warmupSeconds));
          return [
            entry.name,
            scenario,
            integer(runs.length),
            dates.join(", "),
            commits.join(", "),
            warmup > 0 ? `${Math.round(warmup / 60)} min` : "nothing",
          ];
        }),
      ),
    ),
    "### Sizes",
    table(
      ["Size", "People", "Pages", "Spaces", "Attachments", "Active at the same time"],
      data.sizes.map((entry) => [
        entry.name,
        integer(entry.people),
        integer(entry.pages),
        integer(entry.spaces),
        bytes(entry.attachmentBytes),
        integer(entry.concurrentPeople),
      ]),
    ),
    "### Hardware",
    `**Minimum** is what the reference machine used at the peak of the load runs, rounded up: CPU from the busy time of the whole machine, RAM from the Lunedo and PostgreSQL containers. Add what the operating system needs. **Recommended** RAM is the peak × ${RAM_FACTOR}, and recommended CPU keeps the response times below the targets with room for peaks: at least the peak × ${CPU_FACTOR} and at least what the peak scenario used, never more than the reference machine has. Disk is the image, the database, the file store and backups, with ${Math.round((DISK_HEADROOM - 1) * 100)} % headroom; with backups on the same host, it counts the ${backups} backups that the default retention keeps.`,
    table(
      [
        "Size",
        "Minimum CPU",
        "Minimum RAM",
        "Minimum disk",
        "Recommended CPU",
        "Recommended RAM",
        "Recommended disk, backups elsewhere",
        "Recommended disk, backups on this host",
      ],
      derived.map(({ size: entry, values }) => [
        entry.name,
        `${values.minimumCpus} vCPU`,
        `${values.minimumMemoryGiB} GiB`,
        `${integer(values.minimumDiskGB)} GB`,
        cpus(values.recommendedCpus, data),
        `${values.recommendedMemoryGiB} GiB`,
        `${integer(values.diskBackupsElsewhereGB)} GB`,
        `${integer(values.diskBackupsHereGB)} GB`,
      ]),
    ),
    ...missedNote(
      derived.filter(({ values }) => values.recommendedCpus === null).map(({ size: entry }) => entry.name),
    ),
    "### Response times under load",
    "Median of the load runs; p95 is the time within which 95 % of the requests finished. **Readable** is the time until the page is shown in the browser.",
    table(
      ["Size", "Scenario", ...ACTIONS.map(actionName), "Errors"],
      data.sizes.flatMap((entry) =>
        scenariosOf(entry).map((scenario) => {
          const runs = runsOf(entry, scenario);
          return [
            entry.name,
            scenario,
            ...ACTIONS.map(
              (action) =>
                `${duration(median(runs, action, "p50Ms"))} / ${duration(median(runs, action, "p95Ms"))}`,
            ),
            integer(counted(runs).reduce((sum, run) => sum + run.errors.count, 0)),
          ];
        }),
      ),
    ),
    "Each cell shows p50 / p95.",
    "### Targets",
    table(
      ["Size", "Scenario", "Target", "Limit", "Measured (worst run)", "Met"],
      data.sizes.flatMap((entry) =>
        scenariosOf(entry).flatMap((scenario) =>
          targetResults(entry, data.targets, scenario).map((target) => [
            entry.name,
            scenario,
            target.name,
            target.limit,
            target.measured,
            target.met ? "yes" : "no",
          ]),
        ),
      ),
    ),
    "### Footprint and operations",
    table(
      [
        "Size",
        "Database",
        "File store",
        "Image",
        "One full backup",
        "Backup takes",
        "Restore takes",
        "Start until ready",
        "RAM when idle",
        "New page found in search (p95)",
        "Job queue under load (peak)",
      ],
      data.sizes.map((entry) => [
        entry.name,
        bytes(entry.footprint.databaseBytes),
        bytes(entry.footprint.fileStorageBytes),
        bytes(entry.footprint.imageBytes),
        bytes(entry.footprint.backupBytes),
        duration(entry.footprint.backupSeconds * 1000),
        duration(entry.footprint.restoreSeconds * 1000),
        duration(entry.startSeconds * 1000),
        memory(entry.idle.reduce((sum, container) => sum + container.memoryBytes, 0)),
        duration(entry.searchIndexSeconds.p95 * 1000),
        integer(Math.max(...counted(entry.loadRuns).map((run) => run.jobQueue.peak))),
      ]),
    ),
    "### Writing through the API",
    "How fast the content of each size was written through the public API, as a migration script would do it: pages with their versions, attachments, comments and permissions, by several clients at once.",
    table(
      [
        "Size",
        "Clients at once",
        "Pages per minute",
        "Versions per minute",
        "Requests per second",
        "Upload",
        "Busy CPU",
      ],
      data.sizes.flatMap((entry) =>
        entry.bulk.map((bulk) => [
          entry.name,
          integer(bulk.workers),
          integer(bulk.pagesPerMinute),
          integer(bulk.versionsPerMinute),
          integer(bulk.requestsPerSecond),
          `${bulk.uploadMegabytesPerSecond.toFixed(1)} MB/s`,
          `${Math.round(bulk.machineCpuPercent)} %`,
        ]),
      ),
    ),
  ].join("\n\n");
}

function actionName(action: Action): string {
  return {
    pageOpen: "Open a page, API",
    pageReadable: "Open a page, readable",
    search: "Search",
    save: "Save",
    forYou: "For you and notifications",
  }[action];
}

export const requirementsReference = defineReference<RequirementsSource>({
  page: "admin/requirements.md",
  section: "measured-requirements",
  title: "Requirements",
  sources: [DATA, BACKUP_DEFAULTS],
  entry: `
import data from "./${DATA}";
import { DEFAULT_SETTINGS } from "./${BACKUP_DEFAULTS}";

export default { data, retention: DEFAULT_SETTINGS.retention };
`,
  render: renderRequirements,
});
