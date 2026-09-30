import { describe, expect, it } from "vitest";
import { detectLanguage, initI18n, resources } from "./index.js";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) =>
    typeof child === "object" && child !== null ? keys(child, `${prefix}${key}.`) : [`${prefix}${key}`],
  );
}

describe("translations", () => {
  it("define the same keys in every language", () => {
    const english = keys(resources.en.translation).sort();
    for (const [language, resource] of Object.entries(resources)) {
      expect(keys(resource.translation).sort(), language).toEqual(english);
    }
  });

  it("contain no empty strings", () => {
    for (const resource of Object.values(resources)) {
      const values = JSON.stringify(resource.translation).match(/:""/g);
      expect(values).toBeNull();
    }
  });
});

describe("detectLanguage", () => {
  it("picks the first supported browser language", () => {
    expect(detectLanguage(["fr-FR", "de-AT", "en"])).toBe("de");
    expect(detectLanguage(["EN-gb"])).toBe("en");
  });

  it("falls back to English", () => {
    expect(detectLanguage([])).toBe("en");
    expect(detectLanguage(["fr"])).toBe("en");
  });
});

describe("initI18n", () => {
  it("sets the document language", async () => {
    const instance = await initI18n(["de-DE"]);
    expect(document.documentElement.lang).toBe("de");
    expect(instance.t("rail.search")).toBe("Suche");
  });
});
