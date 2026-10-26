import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function jobs(): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /defineJob\(\{\s*name: "([^"]+)",\s*duringMaintenance: "(run|wait)"/g;
  for (const file of sourceFiles(SOURCE)) {
    for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
      found.set(match[1] as string, match[2] as string);
    }
  }
  return found;
}

describe("jobs during maintenance", () => {
  it("hold every job that changes content and keep backups, sweeps, delivery and access removal running", () => {
    const all = jobs();
    expect(all.size).toBeGreaterThan(50);
    const waiting = [...all].filter(([, behavior]) => behavior === "wait").map(([name]) => name);
    expect(waiting.sort()).toEqual([
      "blog.publish-scheduled",
      "content.cleanup",
      "copies.run",
      "encryption.rotate-data-keys",
      "exports.build",
      "files.create-display-versions",
      "files.remove-orphaned",
      "imports.work",
      "knowledge-bases.prune-removed-articles",
      "meetings.remove-template-sections",
      "pages.version-live-sessions",
      "portal.render-article",
      "templates.adopt-files",
      "trash.apply-retention",
    ]);
    for (const name of [
      "identity-providers.synchronize",
      "organizations.process-expiry",
      "api-tokens.process-expiry",
      "mail.deliver",
      "search.update-index",
      "storage.check",
      "audit.apply-retention",
    ]) {
      expect(all.get(name), name).toBe("run");
    }
  });
});
