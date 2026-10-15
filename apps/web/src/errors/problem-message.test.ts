import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/request.js";
import { initI18n } from "../i18n/index.js";
import { problemMessage } from "./problem-message.js";

function problem(code: string, extensions: Record<string, unknown> = {}) {
  return new ApiError(403, {
    type: `urn:pagehall:problem:${code}`,
    title: code,
    status: 403,
    code,
    ...extensions,
  });
}

describe("messages for refused shares", () => {
  it("name how many pages below the sharer's own role does not cover", async () => {
    const { t } = await initI18n(["en"]);
    expect(problemMessage(t, problem("shareBeyondOwnAccess", { uncoveredPages: 3 }))).toBe(
      "Your own role in the space does not cover 3 pages below. Share only this page, choose a lower role, or ask a space admin.",
    );
    expect(problemMessage(t, problem("shareBeyondOwnAccess", { uncoveredPages: 0 }))).toBe(
      "Your own role in the space does not give you this access to the page. Choose a lower role or ask a space admin.",
    );
    expect(problemMessage(t, problem("ownShare"))).toBe(
      "You cannot change access that you hold yourself or through one of your groups. Ask someone else who can share the page.",
    );
  });
});

describe("problem texts", () => {
  it("exist in every language for every problem the API can answer with", async () => {
    const source = readFileSync(path.resolve("../api/src/http/problems.ts"), "utf8");
    const codes = [...source.matchAll(/^ {2}(\w+): \{ status/gm)].map((match) => match[1] ?? "");
    expect(codes.length).toBeGreaterThan(200);
    for (const language of ["en", "de"]) {
      const { t } = await initI18n([language]);
      const missing = codes.filter(
        (code) => problemMessage(t, problem(code)) === problemMessage(t, problem("unknownCode")),
      );
      expect(missing, language).toEqual([]);
    }
  });

  it("explain why a chat address was refused instead of reporting an unexpected answer", async () => {
    const { t } = await initI18n(["en"]);
    expect(problemMessage(t, problem("chatAddressBlocked"))).toBe(
      "The address points to a private network. Use a public address, or ask your instance administrators to allow this network.",
    );
  });
});
