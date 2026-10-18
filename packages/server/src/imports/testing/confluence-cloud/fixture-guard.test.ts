import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const FOLDER = path.join(import.meta.dirname, "fixtures");

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

  it.each(files)("contain no personal address, foreign site, avatar or secret in %s", (file) => {
    const found = contents(file).flatMap((text) =>
      CHECKS.flatMap((check) => check.find(text).map((value) => `${check.what}: ${value.slice(0, 40)}`)),
    );
    expect([...new Set(found)]).toEqual([]);
  });
});
