import { auditEventNames } from "@lunedo/shared";
import { describe, expect, it } from "vitest";
import { auditCatalog } from "./catalog.js";

describe("auditCatalog", () => {
  it("lists the same events that clients translate", () => {
    expect(Object.keys(auditCatalog).sort()).toEqual([...auditEventNames].sort());
  });
});
