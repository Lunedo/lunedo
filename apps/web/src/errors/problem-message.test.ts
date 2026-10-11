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
