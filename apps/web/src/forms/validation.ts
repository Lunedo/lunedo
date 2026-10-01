import type { TFunction } from "i18next";
import type { z } from "zod";

export type Issue = z.core.$ZodIssue;

export type FieldMessages = Record<string, string>;

function bound(issue: Issue, key: "minimum" | "maximum"): number {
  const value = (issue as Partial<Record<typeof key, number | bigint>>)[key];
  return typeof value === "bigint" ? Number(value) : (value ?? 0);
}

export function issueMessage(t: TFunction, issue: Issue, custom?: string): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.input === undefined || issue.input === null || issue.input === ""
        ? t("validation.required")
        : t("validation.invalid");
    case "too_small": {
      const minimum = bound(issue, "minimum");
      if (issue.origin === "string")
        return minimum <= 1 ? t("validation.required") : t("validation.tooShort", { minimum });
      if (issue.origin === "array" || issue.origin === "set") return t("validation.tooFewItems", { minimum });
      return t("validation.tooLow", { minimum });
    }
    case "too_big": {
      const maximum = bound(issue, "maximum");
      if (issue.origin === "string") return t("validation.tooLong", { maximum });
      if (issue.origin === "array" || issue.origin === "set")
        return t("validation.tooManyItems", { maximum });
      return t("validation.tooHigh", { maximum });
    }
    case "invalid_format":
      if (issue.format === "email") return t("validation.email");
      if (issue.format === "url") return t("validation.url");
      return custom ?? t("validation.format");
    case "invalid_value":
      return custom ?? t("validation.choice");
    case "not_multiple_of":
      return t("validation.invalid");
    default:
      return custom ?? t("validation.invalid");
  }
}

export function issuePath(issue: Issue): string {
  return issue.path.map(String).join(".");
}
