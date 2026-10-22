import { emailSchema, organizationNameSchema, slugSchema, timeZoneSchema } from "@lunedo/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { initI18n } from "../i18n/index.js";
import { issueMessage, issuePath } from "./validation.js";

async function messages(language: string, schema: z.ZodType, value: unknown, custom?: string) {
  const i18n = await initI18n([language]);
  const result = schema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => issueMessage(i18n.t, issue, custom));
}

describe("issueMessage", () => {
  it("translates the rules of the shared schemas in every language", async () => {
    expect(await messages("en", organizationNameSchema, "")).toEqual(["This field is required."]);
    expect(await messages("de", organizationNameSchema, "")).toEqual(["Dieses Feld ist erforderlich."]);
    expect(await messages("en", organizationNameSchema, "x".repeat(101))).toEqual([
      "Use at most 100 characters.",
    ]);
    expect(await messages("de", emailSchema, "no address")).toEqual(["Gib eine gültige E-Mail-Adresse ein."]);
  });

  it("uses the field's own message for format rules instead of the server's English text", async () => {
    expect(await messages("de", slugSchema, "Not A Slug", "eigene Meldung")).toEqual(["eigene Meldung"]);
    expect(await messages("en", slugSchema, "Not A Slug")).toEqual(["This value has the wrong format."]);
    expect(await messages("en", timeZoneSchema, "Mars/Base")).toEqual(["This value is not valid."]);
  });

  it("names the path of nested fields", () => {
    const result = z
      .object({ areas: z.object({ spaces: z.enum(["view"]) }) })
      .safeParse({ areas: { spaces: 1 } });
    expect(result.success ? "" : issuePath(result.error.issues[0] as z.core.$ZodIssue)).toBe("areas.spaces");
  });
});
