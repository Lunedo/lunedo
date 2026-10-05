import { describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { normalizeSearch, SETTINGS_INDEX, searchSettings } from "./settings-index.js";

describe("the settings search index", () => {
  it("has a text in every language for every label, description and section", async () => {
    for (const language of ["en", "de"]) {
      const i18n = await initI18n([language]);
      for (const [page, sections] of Object.entries(SETTINGS_INDEX)) {
        for (const section of sections) {
          expect(i18n.exists(section.titleKey), `${language} ${page} ${section.titleKey}`).toBe(true);
          for (const entry of section.entries) {
            expect(i18n.exists(entry.labelKey), `${language} ${entry.labelKey}`).toBe(true);
            if (entry.descriptionKey)
              expect(i18n.exists(entry.descriptionKey), `${language} ${entry.descriptionKey}`).toBe(true);
          }
        }
      }
    }
  });

  it("finds settings by label and description in the current language and names their section", async () => {
    const i18n = await initI18n(["de"]);
    const translate = (key: string) => i18n.t(key as never) as string;
    const byLabel = searchSettings(["instance.general", "instance.security"], "zeitzone", translate);
    expect(byLabel.map((match) => match.entry.id)).toEqual(["locale.timeZone"]);
    expect(byLabel[0]?.sectionTitleKey).toBe("instance.general.localeDefaults");
    const byDescription = searchSettings(["instance.general"], "passkeys", translate);
    expect(byDescription.map((match) => match.entry.id)).toContain("instance.url");
    expect(searchSettings(["instance.general"], "zeitzone", (key) => key)).toEqual([]);
  });

  it("searches only the pages it is given and ignores case, accents and empty queries", () => {
    const translate = (key: string) => (key === "preferences.textSize" ? "Textgröße" : key);
    expect(searchSettings(["account.preferences"], "TEXTGROSSE", translate)).toHaveLength(1);
    expect(searchSettings(["instance.general"], "textgrosse", translate)).toEqual([]);
    expect(searchSettings(["account.preferences"], "   ", translate)).toEqual([]);
    expect(normalizeSearch("Größe")).toBe("grosse");
  });
});
