import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal } from "../../accounts/principal.js";
import { testDatabaseBaseUrl } from "../../testing/database.js";
import { createTestServices, type TestServices } from "../../testing/services.js";
import { spaceFixtures } from "../../testing/spaces.js";
import type { OptionsInput } from "../imports.js";
import {
  countDifferences,
  type MacroOutcome,
  macroDifferences,
  removedRestrictionPages,
  restrictionDifferences,
  spaceCounts,
  trashDifferences,
  withoutRemovedRestrictions,
} from "../testing/confluence-cloud/expectations.js";
import {
  CLOUD_SPACES,
  type CloudSpace,
  cloudExport,
  expected,
  fixturesAvailable,
  recordedConfluence,
  recordedDirectory,
  recordedHomeTitle,
  recordedTrash,
} from "../testing/confluence-cloud/fixtures.js";
import {
  type Difference,
  differences,
  type ImportSnapshot,
  importSnapshot,
} from "../testing/confluence-cloud/snapshot.js";
import { importHarness } from "../testing/harness.js";
import type { ConfluenceTransport } from "./api-client.js";

const baseUrl = testDatabaseBaseUrl();
const SITE = "example.atlassian.net";
const as = (id: string) => accountPrincipal(id);
const OLDER_BACKUP_OF_PAGE = ["versions", "document", "attachments"].map((field) => ({
  page: "page:Onboarding-Ablauf (draw.io)",
  field,
}));
const VISIBLE_ONLY_TO_AUTHOR = [{ page: "page:Private Notizen (nur Autor)", field: "item" }];
const KEPT: MacroOutcome = { kept: true };
const KEPT_MACROS = [
  "align",
  "anchor",
  "bgcolor",
  "blog-posts",
  "calendar",
  "center",
  "change-history",
  "chart",
  "cheese",
  "clickable",
  "colgroup",
  "content-by-user",
  "content-report-table",
  "contributors",
  "contributors-summary",
  "copyright",
  "create-space-button",
  "div",
  "fancy-bullets",
  "favpages",
  "gadget",
  "gallery",
  "global-reports",
  "highlight",
  "htmlcomment",
  "iframe",
  "img",
  "index",
  "jirachart",
  "listlabels",
  "livesearch",
  "loremipsum",
  "lozenge",
  "multimedia",
  "navmap",
  "network",
  "noformat",
  "ol",
  "p",
  "pagetree",
  "pagetreesearch",
  "popular-labels",
  "portfolioforjiraplan",
  "pre",
  "privacy-mark",
  "privacy-policy",
  "profile",
  "profile-picture",
  "questionslist-macro-native",
  "recently-updated",
  "recently-updated-dashboard",
  "recently-used-labels",
  "reg-tm",
  "search",
  "search-box",
  "sharelinks-urlmacro",
  "sm",
  "space-attachments",
  "space-details",
  "spaces",
  "span",
  "strike",
  "style",
  "table",
  "tasklist",
  "tm",
  "ul",
  "unmigrated-inline-wiki-markup",
  "unmigrated-wiki-markup",
  "userlister",
  "viewfile",
  "welcome-message",
];
const NODES = (...nodes: string[]): MacroOutcome => ({ nodes });
const WITH_ALL_OPTIONS = (outcome: MacroOutcome, page: string): MacroOutcome => ({
  ...outcome,
  pages: { [page]: KEPT },
});
const MACRO_REFERENCE_FILES = "Makros: Dateien und Medien";
const MACRO_REFERENCE_LISTS = "Makros: Navigation, Listen und Berichte";
const MACRO_REFERENCE_TASKS = "Makros: Aufgaben, Entscheidungen und Eigenschaften";
const MACRO_REFERENCE_INCLUDES = "Makros: Einbinden, Vorlagen und Jira";
const MACRO_OUTCOMES: Readonly<Record<string, MacroOutcome>> = {
  ...Object.fromEntries(KEPT_MACROS.map((name) => [name, KEPT])),
  "adf-extension": NODES("decision", "drawio", "drawioReference", "callout"),
  "adf-panel": NODES("callout"),
  "anchor-link": { marks: ["link"], pages: { Glossar: { report: "unsupportedLink" } } },
  "app:drawio": NODES("drawio"),
  "app:drawio-sketch": NODES("drawio"),
  "app:gliffy": NODES("drawio"),
  "app:inc-drawio": NODES("drawioReference"),
  attachments: WITH_ALL_OPTIONS(NODES("attachmentList"), MACRO_REFERENCE_FILES),
  card: NODES("tabs"),
  children: WITH_ALL_OPTIONS(NODES("childPages"), MACRO_REFERENCE_LISTS),
  code: NODES("codeBlock"),
  column: NODES("columns"),
  contentbylabel: {
    nodes: ["contentByLabel"],
    pages: { [MACRO_REFERENCE_LISTS]: { nodes: ["contentByLabel"], report: "unmappedQuery" } },
  },
  "create-from-template": WITH_ALL_OPTIONS(NODES("templateButton"), MACRO_REFERENCE_INCLUDES),
  date: NODES("date"),
  decisionreport: WITH_ALL_OPTIONS(NODES("decisionReport"), MACRO_REFERENCE_TASKS),
  decisions: NODES("decision"),
  deck: NODES("tabs"),
  details: NODES("pageProperties"),
  detailssummary: WITH_ALL_OPTIONS(NODES("propertiesReport"), MACRO_REFERENCE_TASKS),
  emoticon: NODES("emoji"),
  excerpt: NODES("excerpt"),
  "excerpt-include": NODES("includeExcerpt"),
  expand: NODES("expand"),
  image: {
    nodes: ["image"],
    pages: Object.fromEntries(
      ["VPN-Verbindung bricht ab", "Projekt Phoenix", "Links zwischen Seiten und Bereichen"].map((title) => [
        title,
        { report: "missingAttachment" },
      ]),
    ),
  },
  include: NODES("includePage"),
  info: NODES("callout"),
  jira: { report: "jiraNotImported" },
  jiraissues: { report: "jiraNotImported" },
  layout: NODES("columns"),
  li: { within: ["ul", "ol"] },
  mention: NODES("mention"),
  note: NODES("callout"),
  panel: { nodes: ["callout"], report: "macroOptionDropped" },
  "related-labels": NODES("relatedLabels"),
  roadmap: NODES("roadmap"),
  roundrect: NODES("callout"),
  section: NODES("columns"),
  status: NODES("status"),
  tasks: NODES("taskList"),
  "tasks-report-macro": WITH_ALL_OPTIONS(NODES("taskReport"), MACRO_REFERENCE_TASKS),
  tbody: { within: ["table"] },
  td: { within: ["table"] },
  th: { within: ["table"] },
  thead: { within: ["table"] },
  tip: NODES("callout"),
  toc: WITH_ALL_OPTIONS(NODES("tableOfContents"), MACRO_REFERENCE_LISTS),
  "toc-zone": NODES("tableOfContents"),
  tr: { within: ["table"] },
  "view-file": NODES("file"),
  viewdoc: NODES("file"),
  viewpdf: NODES("file"),
  viewppt: NODES("file"),
  viewxls: NODES("file"),
  warning: NODES("callout"),
  widget: { report: "embedNotAllowed" },
};
const API_DIFFERENCES: Partial<Record<CloudSpace, readonly { page: string; field: string }[]>> = {};
const SITE_BACKUP_DIFFERENCES: Partial<Record<CloudSpace, readonly { page: string; field: string }[]>> = {
  PHIT: [...OLDER_BACKUP_OF_PAGE, ...VISIBLE_ONLY_TO_AUTHOR],
};

describe.skipIf(!baseUrl || !fixturesAvailable())("Import of the Confluence Cloud test site", () => {
  let test: TestServices;
  let recorded: ReturnType<typeof recordedConfluence>;
  const transport: ConfluenceTransport = { get: (url, request) => recorded.get(url, request) };
  let people: typeof fetch;
  const directory: typeof fetch = (input, init) => people(input, init);
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test, { transport, fetch: directory });
  const snapshots = new Map<string, Promise<ImportSnapshot>>();
  const durations = new Map<string, number>();
  let siteBackup: Buffer;

  beforeAll(async () => {
    recorded = recordedConfluence();
    people = recordedDirectory();
    test = await createTestServices(baseUrl as string, {
      confluenceTransport: transport,
      atlassianFetch: directory,
    });
    siteBackup = cloudExport("site-backup");
  });

  afterAll(async () => {
    if (process.env.PAGEHALL_IMPORT_CHECK_OUT) {
      const resolved: Record<string, ImportSnapshot> = {};
      for (const [key, value] of snapshots)
        resolved[key] = await value.catch(() => ({
          description: "",
          items: [],
          templates: [],
          problems: [],
          roles: [],
        }));
      writeFileSync(
        process.env.PAGEHALL_IMPORT_CHECK_OUT,
        JSON.stringify({ durations: Object.fromEntries(durations), snapshots: resolved }, null, 1),
      );
    }
    await test?.close();
  });

  async function analyzed(archive: Buffer, options?: OptionsInput) {
    const organization = await fixtures.organization();
    const imports = test.services.imports;
    const created = await imports.create(as(organization.owner), organization.id, {
      source: "confluence-xml",
    });
    const uploadId = await harness.upload(organization.owner, organization.id, archive);
    await imports.update(as(organization.owner), created.id, {
      file: { kind: "upload", uploadId },
      ...(options ? { options } : {}),
    });
    await harness.drive(created.id);
    return { organization, view: await imports.get(as(organization.owner), created.id) };
  }

  async function imported(space: CloudSpace, archive: Buffer, label: string, options?: OptionsInput) {
    const started = performance.now();
    const { organization, view: ready } = await analyzed(archive, options);
    expect(ready.state, ready.errorCode ?? "").toBe("ready");
    const imports = test.services.imports;
    const admin = as(organization.owner);
    await imports.update(admin, ready.id, {
      sourceUrl: `https://${SITE}/wiki`,
      spaceName: space,
      spaceKey: `${label.slice(0, 1).toUpperCase()}${space}`,
      history: true,
    });
    await imports.setPeopleSource(admin, ready.id, {
      kind: "token",
      site: SITE,
      email: "importer@example.org",
      token: "recorded-token",
    });
    await imports.start(admin, ready.id);
    await harness.drive(ready.id);
    const view = await imports.get(admin, ready.id);
    durations.set(`${label}:${space}`, Math.round(performance.now() - started));
    expect(view.state, view.errorCode ?? "").toBe("review");
    return importSnapshot(test.database, view.id);
  }

  async function throughApi(space: CloudSpace): Promise<ImportSnapshot> {
    const started = performance.now();
    const organization = await fixtures.organization();
    const imports = test.services.imports;
    const admin = as(organization.owner);
    const draft = await imports.create(admin, organization.id, { source: "confluence-cloud" });
    await imports.update(admin, draft.id, { history: true });
    await imports.setConnection(admin, draft.id, {
      kind: "cloud",
      site: SITE,
      email: "importer@example.org",
      token: "recorded-token",
    });
    await imports.update(admin, draft.id, { options: { spaceKey: space } });
    await harness.drive(draft.id);
    const ready = await imports.get(admin, draft.id);
    expect(ready.state, ready.errorCode ?? "").toBe("ready");
    await imports.update(admin, draft.id, { spaceName: space, spaceKey: `A${space}` });
    await imports.start(admin, draft.id);
    await harness.drive(draft.id);
    const view = await imports.get(admin, draft.id);
    durations.set(`api:${space}`, Math.round(performance.now() - started));
    expect(view.state, view.errorCode ?? "").toBe("review");
    return importSnapshot(test.database, view.id);
  }

  function snapshot(label: "xml" | "site" | "api", space: CloudSpace): Promise<ImportSnapshot> {
    const key = `${label}:${space}`;
    let found = snapshots.get(key);
    if (!found) {
      found =
        label === "xml"
          ? imported(space, cloudExport(space), label)
          : label === "site"
            ? imported(space, siteBackup, label, { spaceKey: space })
            : throughApi(space);
      snapshots.set(key, found);
    }
    return found;
  }

  function unexpected(found: readonly Difference[], known: readonly { page: string; field: string }[]) {
    return found.filter(
      (difference) =>
        !known.some((entry) => difference.page === entry.page && difference.field === entry.field),
    );
  }

  for (const space of CLOUD_SPACES) {
    it(`imports ${space} from its space export as listed in the expected content`, {
      timeout: 300_000,
    }, async () => {
      const result = withoutRemovedRestrictions(await snapshot("xml", space));
      const wanted = expected();
      const trash = recordedTrash(space);
      expect([
        ...countDifferences(spaceCounts(result), wanted.spaces[space], trash.versions),
        ...trashDifferences(result, trash.titles),
        ...restrictionDifferences(space, result, wanted),
      ]).toEqual([]);
    });
  }

  for (const space of CLOUD_SPACES) {
    it(`converts every macro of ${space} as expected`, { timeout: 300_000 }, async () => {
      const result = await snapshot("xml", space);
      expect(macroDifferences(space, result, expected(), MACRO_OUTCOMES, recordedHomeTitle(space))).toEqual(
        [],
      );
    });
  }

  it("keeps restrictions that Confluence marked as removed and lists their pages once", {
    timeout: 300_000,
  }, async () => {
    const fromSpace = await snapshot("xml", "PHIT");
    const pages = removedRestrictionPages(fromSpace);
    expect(pages.length).toBeGreaterThan(0);
    for (const title of pages) {
      const item = fromSpace.items.find((candidate) => candidate.path.split(" › ").at(-1) === title);
      expect(item?.restrictions.edit).toEqual([]);
    }
    const fromApi = await snapshot("api", "PHIT");
    expect(removedRestrictionPages(fromApi)).toEqual([]);
  });

  it("asks which space to import from a site backup", { timeout: 300_000 }, async () => {
    const { view } = await analyzed(siteBackup);
    expect(view.state).toBe("draft");
    expect(view.errorCode).toBe("spaceChoiceRequired");
    expect(view.sourceSpaces?.map((choice) => choice.key)).toEqual(expect.arrayContaining([...CLOUD_SPACES]));
  });

  for (const space of CLOUD_SPACES) {
    it(`imports ${space} from the site backup like from its space export`, { timeout: 300_000 }, async () => {
      const fromSpace = await snapshot("xml", space);
      const fromSite = await snapshot("site", space);
      expect(unexpected(differences(fromSpace, fromSite), SITE_BACKUP_DIFFERENCES[space] ?? [])).toEqual([]);
    });
  }

  for (const space of CLOUD_SPACES) {
    it(`imports ${space} through the API like from its space export`, { timeout: 300_000 }, async () => {
      const fromSpace = withoutRemovedRestrictions(await snapshot("xml", space));
      const fromApi = await snapshot("api", space);
      const skipped = fromApi.problems.filter((problem) => problem.code === "likesAndWatchersSkipped");
      expect(skipped).toHaveLength(1);
      const comparable = {
        ...fromApi,
        problems: fromApi.problems.filter((problem) => !skipped.includes(problem)),
      };
      expect(unexpected(differences(fromSpace, comparable), API_DIFFERENCES[space] ?? [])).toEqual([]);
      expect(recorded.missing).toEqual([]);
    });
  }

  it("imports the page only its author can see from the site backup and keeps it closed", {
    timeout: 300_000,
  }, async () => {
    const author = expected().accounts.find((account) => account.role === "user3")?.accountId;
    const fromSpace = await snapshot("xml", "PHIT");
    const fromSite = await snapshot("site", "PHIT");
    expect(fromSpace.items.some((item) => item.path.endsWith("Private Notizen (nur Autor)"))).toBe(false);
    const page = fromSite.items.find((item) => item.path.endsWith("Private Notizen (nur Autor)"));
    expect(page?.restrictions).toEqual({ view: [author], edit: [author] });
  });

  it("keeps every inline comment anchored to its text", { timeout: 300_000 }, async () => {
    for (const space of CLOUD_SPACES) {
      const comments = (await snapshot("xml", space)).items.flatMap((item) => item.comments);
      const inline = comments.filter((comment) => comment.inline);
      expect(inline.every((comment) => !comment.detached && Boolean(comment.quote))).toBe(true);
    }
  });

  it("imports folders, smart links, live docs, archived pages and notes for whiteboards and databases", {
    timeout: 300_000,
  }, async () => {
    const project = await snapshot("xml", "PHPROJ");
    const edge = await snapshot("xml", "PHEDGE");
    const team = await snapshot("xml", "PHIT");
    const kindOf = (result: ImportSnapshot, title: string) =>
      result.items.find((item) => item.path.split(" › ").at(-1) === title);
    expect(kindOf(project, "Protokolle (Ordner)")?.kind).toBe("folder");
    expect(kindOf(project, "Archiv (Unterordner)")?.path).toBe("Protokolle (Ordner) › Archiv (Unterordner)");
    expect(kindOf(project, "Lenkungskreis 2026-08")?.path).toContain(
      "Archiv (Unterordner) › Lenkungskreis 2026-08",
    );
    expect(kindOf(project, "Brainstorming (Live-Dokument)")?.kind).toBe("page");
    expect(kindOf(edge, "Smart Link (Embed)")).toMatchObject({
      kind: "link",
      linkUrl: "https://example.org/",
    });
    for (const [result, title, type] of [
      [project, "Whiteboard Retrospektive", "whiteboard"],
      [project, "Datenbank Anforderungen", "database"],
    ] as const) {
      const page = kindOf(result, title);
      expect(page?.kind).toBe("page");
      expect(JSON.stringify(page?.document)).toContain(
        type === "whiteboard" ? "Confluence whiteboard" : "Confluence database",
      );
      expect(result.problems).toContainEqual(
        expect.objectContaining({ code: "contentTypeNotImported", details: { type, title } }),
      );
    }
    expect(kindOf(team, "Altes Telefonsystem (abgelöst)")?.archived).toBe(true);
    expect(team.description).toContain("Onboarding");
  });

  it("imports the largest space and the site backup in bounded time and memory", {
    timeout: 600_000,
  }, async () => {
    const measure = async (run: () => Promise<ImportSnapshot>) => {
      const before = process.memoryUsage().heapUsed;
      let peak = before;
      const sampler = setInterval(() => {
        peak = Math.max(peak, process.memoryUsage().heapUsed);
      }, 50);
      const started = performance.now();
      try {
        await run();
      } finally {
        clearInterval(sampler);
      }
      return { milliseconds: performance.now() - started, heap: peak - before };
    };
    const largest = await measure(() => imported("PHEDGE", cloudExport("PHEDGE"), "measure"));
    const backup = await measure(() => imported("PHEDGE", siteBackup, "backup", { spaceKey: "PHEDGE" }));
    for (const result of [largest, backup]) {
      expect(result.milliseconds).toBeLessThan(120_000);
      expect(result.heap).toBeLessThan(512 * 1024 * 1024);
    }
  });
});
