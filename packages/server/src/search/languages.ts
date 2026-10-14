import { type ContentLanguage, contentLanguageSchema, OTHER_CONTENT_LANGUAGE } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import { languageSetting } from "../settings/builtin.js";
import { defineSetting } from "../settings/definition.js";
import type { SettingsService } from "../settings/service.js";

export const SIMPLE_CONFIG = "simple";

const CONFIGS: Record<ContentLanguage, string> = {
  ar: "arabic",
  ca: "catalan",
  da: "danish",
  de: "german",
  el: "greek",
  en: "english",
  es: "spanish",
  eu: "basque",
  fi: "finnish",
  fr: "french",
  ga: "irish",
  hi: "hindi",
  hu: "hungarian",
  hy: "armenian",
  id: "indonesian",
  it: "italian",
  lt: "lithuanian",
  nb: "norwegian",
  ne: "nepali",
  nl: "dutch",
  pt: "portuguese",
  ro: "romanian",
  ru: "russian",
  sr: "serbian",
  sv: "swedish",
  ta: "tamil",
  tr: "turkish",
  yi: "yiddish",
  [OTHER_CONTENT_LANGUAGE]: SIMPLE_CONFIG,
};

export const contentLanguageSetting = defineSetting<ContentLanguage | null>({
  key: "content.language",
  schema: contentLanguageSchema.nullable(),
  default: null,
  levels: ["space"],
  lockable: false,
});

export const searchSettings = [contentLanguageSetting];

export function contentLanguageOf(value: string | null | undefined): ContentLanguage | null {
  const parsed = contentLanguageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function spaceContentLanguage(
  settings: SettingsService,
  organizationId: string | null,
  spaceId: string,
): Promise<ContentLanguage> {
  const organization = organizationId ? { organization: organizationId } : {};
  const own = await settings.get(contentLanguageSetting, { ...organization, space: spaceId });
  return (
    own ?? contentLanguageOf(await settings.get(languageSetting, organization)) ?? OTHER_CONTENT_LANGUAGE
  );
}

export class TextSearchConfigs {
  readonly #executor: Executor;
  #available: Promise<Set<string>> | undefined;

  constructor(executor: Executor) {
    this.#executor = executor;
  }

  async configFor(language: ContentLanguage): Promise<string> {
    this.#available ??= this.#executor
      .execute<{ name: string }>(sql`select cfgname as name from pg_catalog.pg_ts_config`)
      .then((result) => new Set(result.rows.map((row) => row.name)))
      .catch((error: unknown) => {
        this.#available = undefined;
        throw error;
      });
    const config = CONFIGS[language];
    return (await this.#available).has(config) ? config : SIMPLE_CONFIG;
  }
}
