import { slugSchema } from "@lunedo/shared";
import { describe, expect, it } from "vitest";
import { slugFromName } from "./organizations.js";

describe("organization slug from the name", () => {
  it("follows the slug rule for umlauts, sharp s and diacritics", () => {
    expect(slugFromName("Müller & Söhne Straßenbau")).toBe("mueller-soehne-strassenbau");
    expect(slugFromName("Café Zürich")).toBe("cafe-zuerich");
  });

  it("keeps only letters a to z and digits, because the slug is part of addresses people type", () => {
    expect(slugFromName("Москва Team 7")).toBe("team-7");
    expect(slugFromName("東京")).toBe("organization");
    expect(slugSchema.safeParse(slugFromName(`${"Ä".repeat(40)} GmbH`)).success).toBe(true);
  });
});
