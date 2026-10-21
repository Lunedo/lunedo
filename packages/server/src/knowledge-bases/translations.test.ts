import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, accountPrincipal } from "../accounts/principal.js";
import { languageSetting } from "../settings/builtin.js";
import type { KnowledgeBaseAudience } from "../spaces/schema.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe.skipIf(!baseUrl)("knowledge base languages", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const { organization, member } = fixtures;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function setup(audience: KnowledgeBaseAudience = "public", languages: string[] = ["de", "en"]) {
    const org = await organization();
    const editorId = await member(org.id);
    const editor = accountPrincipal(editorId);
    const name = `Hilfe ${randomUUID().slice(0, 8)}`;
    const kb = await test.services.spaces.create(
      editor,
      org.id,
      { name, key: await test.services.spaces.suggestKey(name), type: "knowledgeBase", audience, grants: [] },
      test.services.spacePermissions.holders,
    );
    await test.services.translations.update(editor, kb.id, { defaultLanguage: "de", languages });
    return { org, editorId, editor, kb };
  }

  async function write(actor: ReturnType<typeof accountPrincipal>, itemId: string, text: string) {
    await test.services.documents.replace(actor, itemId, { type: "doc", content: [paragraph(text)] });
    await test.services.versions.publish(actor, itemId);
  }

  async function article(
    actor: ReturnType<typeof accountPrincipal>,
    spaceId: string,
    title: string,
    text: string,
    parentId: string | null = null,
  ) {
    const page = await test.services.tree.create(actor, spaceId, {
      kind: "page",
      title,
      placement: { parentId },
    });
    await write(actor, page.id, text);
    return page.id;
  }

  async function numbers(itemId: string): Promise<number[]> {
    const result = await test.database.execute<{ number: number }>(
      sql`select number from article_numbers where item_id = ${itemId}`,
    );
    return result.rows.map((row) => Number(row.number));
  }

  async function ageVersion(itemId: string, minutes: number) {
    await test.database.execute(sql`
      update page_versions set created_at = now() - make_interval(mins => ${minutes})
      where id = (select published_version_id from tree_items where id = ${itemId})`);
  }

  it("starts a new knowledge base in the language of its organization", async () => {
    const org = await organization();
    const owner = accountPrincipal(org.owner);
    const create = async () => {
      const name = `Hilfe ${randomUUID().slice(0, 8)}`;
      return test.services.spaces.create(
        owner,
        org.id,
        {
          name,
          key: await test.services.spaces.suggestKey(name),
          type: "knowledgeBase",
          audience: "public",
          grants: [],
        },
        test.services.spacePermissions.holders,
      );
    };
    const english = await create();
    expect(await test.services.translations.settings(english.id)).toMatchObject({
      defaultLanguage: "en",
      languages: ["en"],
    });
    await test.settings.set(languageSetting, { organization: org.id }, "organization", "de");
    const german = await create();
    expect(await test.services.translations.settings(german.id)).toMatchObject({
      defaultLanguage: "de",
      languages: ["de"],
    });
  });

  it("does not reveal a translation the editor cannot see", async () => {
    const { org, editor, kb } = await setup();
    const colleagueId = await member(org.id);
    await test.services.spacePermissions.apply(editor, kb.id, {
      action: "grant",
      principalKind: "account",
      principalId: colleagueId,
      role: "editor",
    });
    const original = await article(editor, kb.id, "Drucker", "Drucker einrichten");
    const english = await test.services.translations.create(editor, original, "en");
    await test.services.pageAccess.change(editor, english.id, [{ action: "restrict", kind: "view" }]);
    const colleague = accountPrincipal(colleagueId);
    const hidden = await test.services.translations.create(colleague, original, "en").catch((error) => error);
    expect(hidden).toMatchObject({ code: "translationExists" });
    expect(hidden.details).toEqual({});
    const shown = await test.services.translations.create(editor, original, "en").catch((error) => error);
    expect(shown.details).toEqual({ translationId: english.id });
  });

  it("copies an article with its translations into a knowledge base", async () => {
    const { org, editor, kb } = await setup("signedIn");
    const name = `Ziel ${randomUUID().slice(0, 8)}`;
    const target = await test.services.spaces.create(
      editor,
      org.id,
      {
        name,
        key: await test.services.spaces.suggestKey(name),
        type: "knowledgeBase",
        audience: "signedIn",
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    await test.services.translations.update(editor, target.id, {
      defaultLanguage: "de",
      languages: ["de", "en"],
    });
    const original = await article(editor, kb.id, "Drucker", "Drucker einrichten");
    const english = await test.services.translations.create(editor, original, "en");
    await write(editor, english.id, "Set up the printer");
    const copy = await test.services.copies.copy(editor, original, {
      spaceId: target.id,
      parentId: null,
      descendants: true,
    });
    expect(copy.state).toBe("done");
    const copied = await test.database.execute<{
      id: string;
      translation_of: string | null;
      content_language: string | null;
    }>(sql`
      select id, translation_of, content_language from tree_items where space_id = ${target.id} and kind = 'page'
      order by translation_of nulls first`);
    expect(copied.rows).toHaveLength(2);
    const [copiedOriginal, copiedTranslation] = copied.rows;
    expect(copiedOriginal?.translation_of).toBeNull();
    expect(copiedTranslation).toMatchObject({ translation_of: copiedOriginal?.id, content_language: "en" });
  });

  it("keeps the languages of a knowledge base and audits changes", async () => {
    const { editor, kb } = await setup("signedIn", ["de"]);
    const before = await test.services.translations.settings(kb.id);
    expect(before).toMatchObject({ defaultLanguage: "de", languages: ["de"], progress: [] });
    const changed = await test.services.translations.update(editor, kb.id, { languages: ["en", "fr"] });
    expect(changed.languages).toEqual(["de", "en", "fr"]);
    await expect(
      test.services.translations.update(editor, kb.id, { languages: ["xx"] }),
    ).rejects.toMatchObject({
      code: "invalidLanguage",
    });
    await expect(
      test.services.translations.update(editor, kb.id, { languages: ["other"] }),
    ).rejects.toMatchObject({ code: "invalidLanguage" });
    const audit = await test.database.execute<{ fields: Record<string, unknown> }>(
      sql`select fields from audit_events where target_id = ${kb.id} and name = 'knowledgeBase.languagesChanged'
        order by sequence desc limit 1`,
    );
    expect(audit.rows[0]?.fields).toMatchObject({ languages: ["de", "en", "fr"], previousLanguages: ["de"] });
  });

  it("creates a translation below its original that shares the number and copies the content", async () => {
    const { editor, kb } = await setup();
    const category = await test.services.tree.create(editor, kb.id, {
      kind: "folder",
      title: "IT",
      placement: { parentId: null },
    });
    const source = await article(editor, kb.id, "VPN einrichten", "Öffne den Client.", category.id);
    const translation = await test.services.translations.create(editor, source, "en");
    expect(translation.parentId).toBe(source);
    expect(await numbers(translation.id)).toEqual([]);
    expect(await numbers(source)).toHaveLength(1);
    const draft = await test.database.execute<{ snapshot: unknown }>(
      sql`select snapshot from page_documents where item_id = ${translation.id}`,
    );
    expect(JSON.stringify(draft.rows[0]?.snapshot)).toContain("Öffne den Client.");
    await expect(test.services.translations.create(editor, source, "en")).rejects.toMatchObject({
      code: "translationExists",
    });
    await expect(test.services.translations.create(editor, source, "fr")).rejects.toMatchObject({
      code: "languageNotEnabled",
    });
    await expect(test.services.translations.create(editor, source, "de")).rejects.toMatchObject({
      code: "languageNotEnabled",
    });
    await expect(test.services.translations.create(editor, translation.id, "en")).rejects.toMatchObject({
      code: "translationSource",
    });
    await expect(test.services.tree.setContentLanguage(editor, source, "en")).rejects.toMatchObject({
      code: "knowledgeBaseLanguage",
    });
    const listed = await test.services.knowledgeBases.articles(editor, kb.id);
    expect(listed.items.map((entry) => entry.id)).toEqual([source]);
    expect(listed.items[0]).toMatchObject({
      language: "de",
      categoryPath: [{ id: category.id, title: "IT" }],
      translations: [{ language: "en", itemId: translation.id, state: "unpublished" }],
    });
    const read = await test.services.knowledgeBases.article(editor, translation.id, { draft: true });
    expect(read).toMatchObject({
      language: "en",
      translationOf: source,
      categoryPath: [{ id: category.id }],
    });
  });

  it("moves translations with their article and refuses moving them alone", async () => {
    const { editor, kb } = await setup();
    const first = await test.services.tree.create(editor, kb.id, {
      kind: "folder",
      title: "Personal",
      placement: { parentId: null },
    });
    const second = await test.services.tree.create(editor, kb.id, {
      kind: "folder",
      title: "Akademie",
      placement: { parentId: null },
    });
    const source = await article(editor, kb.id, "Urlaub beantragen", "Formular ausfüllen.", first.id);
    const translation = await test.services.translations.create(editor, source, "en");
    await expect(
      test.services.tree.move(editor, translation.id, { parentId: second.id }),
    ).rejects.toMatchObject({ code: "translationPlacement" });
    await test.services.tree.move(editor, source, { parentId: second.id });
    const path = await test.database.execute<{ path: string[]; translation_of: string | null }>(
      sql`select path, translation_of from tree_items where id = ${translation.id}`,
    );
    expect(path.rows[0]?.path).toEqual([second.id, source, translation.id]);
    expect(path.rows[0]?.translation_of).toBe(source);
  });

  it("marks a translation as outdated when its original is published after it", async () => {
    const { editor, kb } = await setup();
    const source = await article(editor, kb.id, "Drucker", "Drucker im Flur.");
    const translation = await test.services.translations.create(editor, source, "en");
    await write(editor, translation.id, "Printer in the hallway.");
    await ageVersion(source, 20);
    let states = await test.services.translations.translations(editor, source);
    expect(states?.translations.find((entry) => entry.language === "en")?.state).toBe("current");
    await ageVersion(translation.id, 10);
    await write(editor, source, "Drucker im zweiten Stock.");
    states = await test.services.translations.translations(editor, translation.id);
    expect(states).toMatchObject({ sourceId: source, language: "en" });
    expect(states?.translations.find((entry) => entry.language === "en")?.state).toBe("outdated");
    const settings = await test.services.translations.settings(kb.id);
    expect(settings.progress).toEqual([{ language: "en", translated: 1, outdated: 1, missing: 0 }]);
    const reviews = await test.services.reviews.list(editor, kb.id, {
      filter: "translations",
      page: { limit: 50 },
    });
    expect(reviews.items.map((entry) => entry.id)).toEqual([translation.id]);
    expect(reviews.items[0]).toMatchObject({ language: "en", translationOutdated: true });
    expect(reviews.counts.translations).toBe(1);
  });

  it("refuses a default language that already has translations", async () => {
    const { editor, kb } = await setup();
    const source = await article(editor, kb.id, "WLAN", "Verbinden.");
    await test.services.translations.create(editor, source, "en");
    await expect(
      test.services.translations.update(editor, kb.id, { defaultLanguage: "en" }),
    ).rejects.toMatchObject({ code: "defaultLanguageTranslated" });
  });

  describe("portal", () => {
    async function config(spaceId: string) {
      const found = await test.services.portals.config(spaceId);
      if (!found) throw new Error("no portal");
      return found;
    }

    it("shows the reader's language and falls back to the default language with a note", async () => {
      const { editor, kb } = await setup();
      const translated = await article(editor, kb.id, "Passwort ändern", "Neues Passwort wählen.");
      const english = await test.services.translations.create(editor, translated, "en");
      await test.services.tree.update(editor, english.id, { title: "Change the password" });
      await write(editor, english.id, "Choose a new password.");
      const untranslated = await article(editor, kb.id, "Drucker", "Drucker im Flur.");
      await test.services.search.indexer.drain();
      const portal = await config(kb.id);
      const [number] = await numbers(translated);
      const shown = await test.services.portalReader.article(ANONYMOUS, portal, number ?? 0, "", "en");
      expect(shown?.type === "found" && shown.article).toMatchObject({
        itemId: english.id,
        language: "en",
        slug: "change-the-password",
        fallback: false,
        alternates: [
          { language: "de", slug: "passwort-aendern" },
          { language: "en", slug: "change-the-password" },
        ],
      });
      const german = await test.services.portalReader.article(ANONYMOUS, portal, number ?? 0, "", "de");
      expect(german?.type === "found" && german.article).toMatchObject({
        itemId: translated,
        fallback: false,
      });
      const [other] = await numbers(untranslated);
      const fallback = await test.services.portalReader.article(ANONYMOUS, portal, other ?? 0, "", "en");
      expect(fallback?.type === "found" && fallback.article).toMatchObject({
        itemId: untranslated,
        language: "de",
        fallback: true,
      });
      const list = await test.services.portalReader.articles(ANONYMOUS, portal, {
        language: "en",
        sort: "title",
      });
      expect(list.articles.map((entry) => [entry.itemId, entry.language]).sort()).toEqual(
        [
          [english.id, "en"],
          [untranslated, "de"],
        ].sort(),
      );
      const defaultList = await test.services.portalReader.articles(ANONYMOUS, portal, { language: "de" });
      expect(defaultList.articles.map((entry) => entry.itemId).sort()).toEqual(
        [translated, untranslated].sort(),
      );
    });

    it("hides translations of languages that are not enabled", async () => {
      const { editor, kb } = await setup();
      const source = await article(editor, kb.id, "Zugang", "Zugang beantragen.");
      const english = await test.services.translations.create(editor, source, "en");
      await write(editor, english.id, "Request access.");
      await test.services.translations.update(editor, kb.id, { languages: ["de"] });
      await test.services.search.indexer.drain();
      const portal = await config(kb.id);
      const [number] = await numbers(source);
      const found = await test.services.portalReader.article(ANONYMOUS, portal, number ?? 0, "", "en");
      expect(found?.type === "found" && found.article).toMatchObject({
        itemId: source,
        alternates: [{ language: "de" }],
      });
    });

    it("searches the reader's language together with the default language, the reader's first", async () => {
      const { editor, kb } = await setup();
      const source = await article(editor, kb.id, "Bildschirm", "Monitor anschließen mit Kabel.");
      const english = await test.services.translations.create(editor, source, "en");
      await write(editor, english.id, "Connect the screen with the cable.");
      const untranslated = await article(editor, kb.id, "Adapter", "Den cable Adapter benutzen.");
      await article(editor, kb.id, "Tastatur", "Tastatur reinigen.");
      await test.services.search.indexer.drain();
      const portal = await config(kb.id);
      const search = (query: string, language: string) =>
        test.services.portalReader.search(ANONYMOUS, portal, {
          query,
          categoryId: null,
          type: null,
          cursor: null,
          language,
        });
      const both = await search("cable", "en");
      expect(both.total).toBe(2);
      expect(both.results.map((hit) => [hit.itemId, hit.language])).toEqual([
        [english.id, "en"],
        [untranslated, "de"],
      ]);
      const defaultOnly = await search("Tastatur", "en");
      expect(defaultOnly.results.map((hit) => hit.language)).toEqual(["de"]);
      const original = await search("Monitor", "en");
      expect(original.results.map((hit) => hit.itemId)).toEqual([source]);
      const german = await search("cable", "de");
      expect(german.results.map((hit) => hit.itemId)).toEqual([untranslated]);
    });

    it("finds existing articles again after the default language changed", async () => {
      const { editor, kb } = await setup("public", ["de"]);
      const page = await article(editor, kb.id, "Urlaub", "Urlaub beantragen im Portal.");
      await test.services.search.indexer.drain();
      const portal = await config(kb.id);
      const before = await test.services.portalReader.search(ANONYMOUS, portal, {
        query: "Urlaub",
        categoryId: null,
        type: null,
        cursor: null,
      });
      expect(before.total).toBe(1);
      const changed = await test.services.translations.update(editor, kb.id, {
        defaultLanguage: "en",
        languages: ["en"],
      });
      expect(changed.searchUpdate).toMatchObject({ remaining: 1, total: 1 });
      await test.services.search.indexer.drain();
      expect((await test.services.translations.settings(kb.id)).searchUpdate).toBeNull();
      const after = await test.services.portalReader.search(ANONYMOUS, await config(kb.id), {
        query: "Urlaub",
        categoryId: null,
        type: null,
        cursor: null,
      });
      expect(after.results.map((hit) => [hit.itemId, hit.language])).toEqual([[page, "en"]]);
    });
  });

  describe("changes for programs", () => {
    async function synced(spaceId: string) {
      const result = await test.database.execute<{
        item_id: string;
        number: number | null;
        language: string | null;
        removed_reason: string | null;
      }>(sql`select item_id, number, language, removed_reason from article_sync where space_id = ${spaceId}
        order by number, language`);
      return result.rows.map((row) => ({ ...row, number: row.number === null ? null : Number(row.number) }));
    }

    it("records published articles and translations and keeps a tombstone when one is deleted", async () => {
      const { editor, kb } = await setup();
      const source = await article(editor, kb.id, "Konto", "Konto anlegen.");
      const english = await test.services.translations.create(editor, source, "en");
      expect(await synced(kb.id)).toEqual([
        { item_id: source, number: (await numbers(source))[0], language: "de", removed_reason: null },
      ]);
      await write(editor, english.id, "Create an account.");
      const [number] = await numbers(source);
      expect(await synced(kb.id)).toEqual([
        { item_id: source, number, language: "de", removed_reason: null },
        { item_id: english.id, number, language: "en", removed_reason: null },
      ]);
      await test.services.trash.deleteItem(editor, english.id);
      expect((await synced(kb.id)).find((row) => row.item_id === english.id)?.removed_reason).toBe("deleted");
    });
  });
});
