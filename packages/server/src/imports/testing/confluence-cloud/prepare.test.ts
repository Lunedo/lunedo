import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createZip } from "../zip-writer.js";
import {
  type Actor,
  canonicalQuery,
  collectIds,
  createAnonymizer,
  findProblems,
  parseExpected,
  prepare,
  readZip,
} from "./prepare.js";

const ACTORS: Actor[] = [
  {
    role: "admin",
    accountId: "712020:aaaaaaaa-1111-4111-8111-111111111111",
    displayName: "Rosa Lindqvist",
    email: "rosa.lindqvist@mailbox.test",
  },
  {
    role: "user2",
    accountId: "712020:bbbbbbbb-2222-4222-8222-222222222222",
    displayName: "Quillon",
    email: "quillon@mailbox.test",
  },
];
const SITE = "https://demo-wiki.atlassian.net";
const OTHER = "557058:cccccccc-3333-4333-8333-333333333333";
const LEGACY = "5b70c8b80fd0ac05d389f5e9";
const CLOUD = "dddddddd-4444-4444-8444-444444444444";

function anonymizer(texts: string[]) {
  return createAnonymizer({ actors: ACTORS, site: SITE, ...collectIds(texts) });
}

describe("anonymizing the Confluence Cloud test data", () => {
  const sample = [
    `creator ${ACTORS[0]?.accountId} and ${OTHER} and ${LEGACY}`,
    `GET /wiki/rest/api/user?accountId=712020%3Aaaaaaaaa-1111-4111-8111-111111111111`,
    "localStorage/atlassian.712020_aaaaaaaa-1111-4111-8111-111111111111.frontend",
    "space ~712020aaaaaaaa111141118111111111111111 of Rosa Lindqvist",
    "searchString: name rosa lindqvist type user",
    "mail ROSA.LINDQVIST@mailbox.test, group demo-wikiteam at https://demo-wiki.atlassian.net/wiki",
    `<ac:adf-parameter key="cloud-id">${CLOUD}</ac:adf-parameter> ari:cloud:confluence:${CLOUD}:page/1`,
    `{"base64EncodedAri":"${Buffer.from(`ari:cloud:confluence:${CLOUD}:content/1`).toString("base64")}"}`,
  ];

  it("replaces account IDs, names, e-mail addresses and the site name the same way everywhere", () => {
    const clean = anonymizer(sample);
    const result = sample.map((text) => clean.text(text));
    expect(result[0]).toBe(
      "creator 712020:00000000-0000-4000-8000-000000000001 and 557058:00000000-0000-4000-8000-000000000003 and 000000000000000000000004",
    );
    expect(result[1]).toContain("accountId=712020%3A00000000-0000-4000-8000-000000000001");
    expect(result[2]).toContain("712020_00000000-0000-4000-8000-000000000001");
    expect(result[3]).toBe("space ~71202000000000000040008000000000000001 of Test User 1");
    expect(result[4]).toBe("searchString: name test user 1 type user");
    expect(result[5]).toBe(
      "mail user1@example.org, group example-team at https://example.atlassian.net/wiki",
    );
    expect(result[6]).not.toContain(CLOUD);
    expect(
      Buffer.from(JSON.parse(result[7] ?? "{}").base64EncodedAri, "base64").toString("utf8"),
    ).not.toContain(CLOUD);
    for (const text of result) expect(findProblems("sample", text, clean)).toEqual([]);
  });

  it("finds personal data, foreign e-mail addresses and secrets that are left", () => {
    const clean = anonymizer(sample);
    const hidden = Buffer.from("written by Rosa Lindqvist").toString("base64");
    expect(findProblems("page", "Quillon was here", clean)).toEqual([
      "page: personal data left (7 characters)",
    ]);
    expect(findProblems("page", hidden, clean)).toContain(
      "page: personal data left in Base64 (14 characters)",
    );
    expect(findProblems("page", "write to someone@private.test", clean)).toEqual([
      "page: e-mail address left at domain private.test",
    ]);
    expect(findProblems("page", "token ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz", clean)).toEqual([
      "page: looks like a Atlassian API token",
    ]);
    expect(findProblems("page", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123", clean)).toEqual([
      "page: looks like a bearer token",
    ]);
    expect(findProblems("page", "user1@example.org and app@connect.atlassian.com", clean)).toEqual([
      "page: e-mail address left at domain connect.atlassian.com",
    ]);
    expect(findProblems("page", "see https://other.atlassian.net/wiki", clean)).toEqual([
      "page: Atlassian site other.atlassian.net left",
    ]);
    expect(findProblems("page", "https://api.media.atlassian.com/file/1", clean)).toEqual([
      "page: avatar or media address left",
    ]);
    expect(findProblems("page", '{"displayName":"Erika Muster"}', clean, new Set(["Draw app"]))).toEqual([
      "page: person name left in a name field (12 characters)",
    ]);
    expect(
      findProblems(
        "page",
        '{"displayName":"Draw app","publicName":"Test User 2"}',
        clean,
        new Set(["Draw app"]),
      ),
    ).toEqual([]);
  });

  it("keys recorded requests by their sorted query", () => {
    expect(canonicalQuery({ status: ["trashed", "current"], depth: "all" })).toBe(
      "depth=all&status=current&status=trashed",
    );
  });

  it("reads ZIP archives it compares against", () => {
    const zip = createZip([
      { name: "entities.xml", data: "<root/>", deflate: true },
      { name: "attachments/1/2/1", data: Buffer.from([0, 1, 2]) },
    ]);
    expect(readZip(zip)).toEqual([
      { name: "entities.xml", data: Buffer.from("<root/>") },
      { name: "attachments/1/2/1", data: Buffer.from([0, 1, 2]) },
    ]);
  });

  it("turns the expected content into machine-readable data and refuses unknown rows", () => {
    const markdown = [
      "# Erwarteter Inhalt",
      "## Konten",
      "| Rolle | Anzeigename | Account-ID | E-Mail |",
      "|---|---|---|---|",
      "| admin | Test User 1 | `712020:00000000-0000-4000-8000-000000000001` | user1@example.org |",
      "## Zählwerte je Bereich",
      "| | AA | BB |",
      "|---|---:|---:|",
      "| Seiten aktuell (inkl. Startseite) | 3 | 4 |",
      "| Inline-Kommentare offen / erledigt | 1 / 0 | 0 / 2 |",
      "### Beschränkungen",
      "- **AA** Lesen: Seite A, Seite B · Bearbeiten: Seite C",
      "## Sonderfälle (Checkliste)",
      "- [ ] Baum mit Ebenen",
      "## Makros und die Seiten, die sie verwenden",
      "| Makro | Seiten |",
      "|---|---|",
      "| `info` | AA › Seite A; BB › Seite › mit Pfeil |",
      "## Drittanbieter (draw.io, Gliffy)",
      "- AA › Plan (draw.io) (draw.io): vorhanden (drawio, drawio-sketch)",
    ].join("\n");
    expect(parseExpected(markdown)).toEqual({
      accounts: [
        {
          role: "admin",
          displayName: "Test User 1",
          accountId: "712020:00000000-0000-4000-8000-000000000001",
          email: "user1@example.org",
        },
      ],
      spaces: {
        AA: { pages: 3, inlineComments: { open: 1, resolved: 0 } },
        BB: { pages: 4, inlineComments: { open: 0, resolved: 2 } },
      },
      restrictions: [{ space: "AA", view: ["Seite A", "Seite B"], edit: ["Seite C"] }],
      macros: {
        info: [
          { space: "AA", title: "Seite A" },
          { space: "BB", title: "Seite › mit Pfeil" },
        ],
      },
      thirdParty: [{ space: "AA", title: "Plan (draw.io)", macros: ["app:drawio", "app:drawio-sketch"] }],
      checks: ["Baum mit Ebenen"],
    });
    expect(() => parseExpected(markdown.replace("Seiten aktuell", "Unbekannte Zeile"))).toThrow(
      "Unknown row in expected.md",
    );
  });
});

describe("preparing the fixtures", () => {
  const folders: string[] = [];

  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function source(page: string, spaceKey = "AA", entry = "entities.xml"): string {
    const parent = mkdtempSync(path.join(tmpdir(), "confluence-fixtures-"));
    folders.push(parent);
    const folder = path.join(parent, "confluence-cloud");
    mkdirSync(path.join(folder, "api-recording", "requests"), { recursive: true });
    mkdirSync(path.join(folder, "xml"));
    const request = {
      request: { actor: "admin", method: "GET", path: "/wiki/api/v2/pages/1", query: {} },
      response: {
        status: 200,
        contentType: "application/json",
        body: { title: page, authorId: ACTORS[0]?.accountId },
      },
    };
    writeFileSync(path.join(folder, "api-recording", "requests", "page.json"), JSON.stringify(request));
    writeFileSync(
      path.join(folder, "api-recording", "index.json"),
      JSON.stringify({
        site: SITE,
        actors: Object.fromEntries(ACTORS.map(({ role, ...actor }) => [role, actor])),
        spaces: [{ key: "AA" }],
        entries: [{ key: "admin GET /wiki/api/v2/pages/1?", file: "requests/page.json", status: 200 }],
      }),
    );
    writeFileSync(
      path.join(folder, "xml", "AA.zip"),
      createZip([
        {
          name: "exportDescriptor.properties",
          data: `exportType=space
spaceKey=${spaceKey}
source=cloud
`,
        },
        {
          name: entry,
          data: `<title>${page}</title><key>${ACTORS[1]?.accountId}</key>`,
          deflate: true,
        },
      ]),
    );
    writeFileSync(
      path.join(folder, "expected.md"),
      [
        "## Konten",
        "## Zählwerte je Bereich",
        "| | AA |",
        "|---|---:|",
        "## Makros und die Seiten, die sie verwenden",
        "## Drittanbieter (draw.io, Gliffy)",
        "## Sonderfälle (Checkliste)",
        "### Beschränkungen",
      ].join("\n"),
    );
    return folder;
  }

  it("writes compressed, anonymized bundles of the exports and the recording", () => {
    const folder = source("Notes of Rosa Lindqvist");
    const target = path.join(folder, "out");
    const { files } = prepare(folder, target);
    expect(files.map((file) => file.name)).toEqual([
      "AA.jsonl.gz",
      "api-recording.jsonl.gz",
      "expected.json",
    ]);
    const exported = gunzipSync(readFileSync(path.join(target, "AA.jsonl.gz"))).toString("utf8");
    expect(exported).toContain("Notes of Test User 1");
    expect(exported).toContain("712020:00000000-0000-4000-8000-000000000002");
    const recorded = JSON.parse(
      gunzipSync(readFileSync(path.join(target, "api-recording.jsonl.gz"))).toString("utf8"),
    );
    expect(recorded).toMatchObject({
      key: "admin GET /wiki/api/v2/pages/1?",
      body: { title: "Notes of Test User 1", authorId: "712020:00000000-0000-4000-8000-000000000001" },
    });
  });

  it("reads only from the folder of the test site", () => {
    const folder = source("Notes");
    expect(() => prepare(path.join(folder, "..", "other"), path.join(folder, "out"))).toThrow(
      "does not exist",
    );
    mkdirSync(path.join(folder, "..", "confluence"));
    expect(() => prepare(path.join(folder, "..", "confluence"), path.join(folder, "out"))).toThrow(
      "only from the folder confluence-cloud",
    );
  });

  it("refuses archives of other spaces and archive entries that leave the archive", () => {
    expect(() => prepare(source("Notes", "RMA"), path.join(tmpdir(), "unused"))).toThrow(
      "AA.zip is not an export of the test site",
    );
    expect(() => prepare(source("Notes", "AA", "../entities.xml"), path.join(tmpdir(), "unused"))).toThrow(
      "unsafe entry",
    );
  });

  it("writes nothing when something looks like a secret", () => {
    const folder = source("Key ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz");
    expect(() => prepare(folder, path.join(folder, "out"))).toThrow("looks like a Atlassian API token");
  });
});
