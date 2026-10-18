import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const FOLDER = path.join(import.meta.dirname, "fixtures");
const TEST_SITE = "pagehall-test";
const ALLOWED_NAMES = new Set([
  "",
  "System",
  "Chat Notifications",
  "draw.io Diagrams",
  "draw.io Diagrams | UML, BPMN, AWS, ERD, & Flowcharts",
  "Gliffy Diagram for Confluence",
  "Gliffy Diagrams for Confluence",
  "Microsoft Teams for Confluence Cloud",
]);
const NAME_FIELD = "[A-Za-z]*(?:[Dd]isplay|[Pp]ublic|[Ff]ull|[Aa]uthor|[Cc]reator|[Mm]odifier|[Uu]ser)Name";
const JSON_NAME = new RegExp(String.raw`\\?"(?:${NAME_FIELD})\\?"\s*:\s*\\?"((?:[^"\\]|\\[^"])*)`, "g");
const XML_NAME = new RegExp(
  String.raw`<property name=\\?"(?:${NAME_FIELD})\\?"[^>/]*>(?:<!\[CDATA\[)?((?:[^<\]\\]|\\[^"])*)`,
  "g",
);

function allowedName(name: string): boolean {
  return /^Test User \d+$/.test(name) || ALLOWED_NAMES.has(name);
}

function jsonString(escaped: string): string {
  try {
    return JSON.parse(`"${escaped}"`) as string;
  } catch {
    return escaped;
  }
}

const CHECKS: readonly { readonly what: string; readonly find: (text: string) => string[] }[] = [
  {
    what: "e-mail address outside example.org",
    find: (text) =>
      [...text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)]
        .filter((match) => match[1]?.toLowerCase() !== "example.org")
        .map((match) => match[0]),
  },
  {
    what: "Atlassian site other than example.atlassian.net",
    find: (text) =>
      [...text.matchAll(/[A-Za-z0-9-]+\.atlassian\.net/gi)]
        .map((match) => match[0])
        .filter((host) => host.toLowerCase() !== "example.atlassian.net"),
  },
  {
    what: "name of the test site",
    find: (text) => [...text.matchAll(new RegExp(TEST_SITE, "gi"))].map((match) => match[0]),
  },
  {
    what: "person name other than a test user or app",
    find: (text) =>
      [...text.matchAll(JSON_NAME), ...text.matchAll(XML_NAME)]
        .map((match) => jsonString(match[1] ?? "").trim())
        .filter((name) => !allowedName(name)),
  },
  {
    what: "avatar or media address",
    find: (text) =>
      [
        ...text.matchAll(
          /aa-avatar|avatar-management|gravatar\.com|[a-z0-9.-]*media\.atlassian\.com|api\.media\./gi,
        ),
      ].map((match) => match[0]),
  },
  {
    what: "token or secret",
    find: (text) =>
      [
        /ATATT[A-Za-z0-9_\-=]{20,}/g,
        /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/g,
        /\bBasic\s+[A-Za-z0-9+/]{20,}={0,2}/g,
        /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./g,
        /\bAKIA[0-9A-Z]{16}\b/g,
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
        /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
        /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
        /[?&](?:token|access_token|api_key|apikey|jwt)=[A-Za-z0-9._-]{16,}/gi,
      ].flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0])),
  },
];

function contents(file: string): string[] {
  const data = readFileSync(path.join(FOLDER, file));
  if (!file.endsWith(".gz")) return [data.toString("utf8")];
  const text = gunzipSync(data).toString("utf8");
  const decoded = [...text.matchAll(/"(?:base64)":"([A-Za-z0-9+/=]*)"/g)].map((match) =>
    Buffer.from(match[1] ?? "", "base64").toString("latin1"),
  );
  return [text, ...decoded];
}

describe("fixtures of the Confluence Cloud test site", () => {
  const files = readdirSync(FOLDER).sort();

  it("exist", () => {
    expect(files).toEqual(
      expect.arrayContaining(["api-recording.jsonl.gz", "expected.json", "site-backup.jsonl.gz"]),
    );
  });

  it.each(files)("contain no personal address, name, foreign site, avatar or secret in %s", (file) => {
    expect(problems(contents(file))).toEqual([]);
  });

  it("detects person names and the name of the test site", () => {
    const escaped = (value: string) => JSON.stringify(value).slice(1, -1);
    const leaks = [
      '{"displayName":"Rosa Lindqvist","publicName":"Test User 1"}',
      escaped('{"author":{"publicName":"Rosa Lindqvist"}}'),
      '<property name="authorFullName"><![CDATA[Rosa Lindqvist]]></property>',
      escaped('<property name="fullName"><![CDATA[Rosa Lindqvist]]></property>'),
      `see ${TEST_SITE.toUpperCase()} for details`,
    ];
    for (const leak of leaks) expect(problems([leak])).not.toEqual([]);
    const allowed = [
      '{"displayName":"Test User 12","publicName":"draw.io Diagrams","groupName":"it-team"}',
      escaped('{"displayName":"Chat Notifications"}'),
      '<property name="authorFullName"><![CDATA[System]]></property><property name="authorName"/>',
      '<property name="diagramName"><![CDATA[Network]]></property>',
    ];
    for (const text of allowed) expect(problems([text])).toEqual([]);
  });
});

function problems(texts: readonly string[]): string[] {
  const found = texts.flatMap((text) =>
    CHECKS.flatMap((check) => check.find(text).map((value) => `${check.what}: ${value.slice(0, 40)}`)),
  );
  return [...new Set(found)];
}
