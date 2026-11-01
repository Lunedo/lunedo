import { existsSync } from "node:fs";
import path from "node:path";
import { documentationTargets } from "@lunedo/shared";
import { describe, expect, it } from "vitest";
import { docsUrl } from "./docs-url.js";

const docsFolder = path.resolve(import.meta.dirname, "../../../../docs");

describe("docsUrl", () => {
  it("links a page to its address on lunedo.org", () => {
    expect(docsUrl("admin/rendering.md")).toBe("https://lunedo.org/docs/admin/rendering/");
    expect(docsUrl("/admin/identity-providers/entra-id.md")).toBe(
      "https://lunedo.org/docs/admin/identity-providers/entra-id/",
    );
  });

  it("keeps the anchor", () => {
    expect(docsUrl("admin/reverse-proxy.md#forwarded-headers-and-lunedo_trusted_proxies")).toBe(
      "https://lunedo.org/docs/admin/reverse-proxy/#forwarded-headers-and-lunedo_trusted_proxies",
    );
  });

  it("links a README to the index of its section", () => {
    expect(docsUrl("README.md")).toBe("https://lunedo.org/docs/");
    expect(docsUrl("admin/README.md#start")).toBe("https://lunedo.org/docs/admin/#start");
  });

  it.each(Object.entries(documentationTargets))("links %s to an existing page", (_name, target) => {
    const [file = "", anchor] = target.split("#");
    expect(existsSync(path.join(docsFolder, file))).toBe(true);
    const page = file === "README.md" ? "" : `${file.replace(/\.md$/, "")}/`;
    expect(docsUrl(target)).toBe(
      `https://lunedo.org/docs/${page}${anchor === undefined ? "" : `#${anchor}`}`,
    );
  });
});
