import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { MAX_AUDIENCE_GROUPS } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { originOf } from "../http/instance-url.js";
import { nameCursor, pageQuery, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";
import {
  articleTypeSchema,
  audienceSchema,
  documentSchema,
  exampleItem,
  exampleSpace,
  treeItemSchema,
} from "./schemas.js";

const TAG = "Knowledge bases";

const languageSchema = z.string().describe("Language as a two-letter code such as `de` or `en`.");

const translationStateSchema = z
  .enum(["original", "current", "outdated", "unpublished", "missing"])
  .describe(
    "`original`: the article in the default language. `current`: published after its original. `outdated`: the original was published after it. `unpublished`: never published. `missing`: no translation yet.",
  );

const languagesSchema = z
  .object({
    spaceId: uuid("ID of the knowledge base."),
    defaultLanguage: languageSchema.describe(
      "Language of new articles and fallback for readers whose language has no translation.",
    ),
    languages: z
      .array(languageSchema)
      .describe("Enabled languages, including the default language. The portal offers a choice from two on."),
    articles: z.number().int().describe("Published articles in the default language."),
    progress: z
      .array(
        z
          .object({
            language: languageSchema,
            translated: z.number().int().describe("Articles with a published translation."),
            outdated: z.number().int().describe("Translations whose original was published after them."),
            missing: z.number().int().describe("Articles without a published translation."),
          })
          .describe("State of the translations into one language."),
      )
      .describe("State of the translations per enabled language other than the default."),
  })
  .describe("Languages of a knowledge base.");

const exampleLanguages = {
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  defaultLanguage: "de",
  languages: ["de", "en"],
  articles: 140,
  progress: [{ language: "en", translated: 12, outdated: 2, missing: 128 }],
};

const languagesBodySchema = z
  .object({
    defaultLanguage: languageSchema.optional(),
    languages: z
      .array(languageSchema)
      .max(30)
      .optional()
      .describe("Enabled languages. The default language is always enabled."),
  })
  .strict()
  .describe("The changed languages.");

const translationsSchema = z
  .object({
    sourceId: uuid("ID of the original article."),
    spaceId: uuid("ID of the knowledge base."),
    defaultLanguage: languageSchema,
    language: languageSchema.describe("Language of the article that was asked for."),
    translations: z
      .array(
        z
          .object({
            language: languageSchema,
            itemId: uuid("ID of the article in this language, or null.").nullable(),
            title: z.string().nullable().describe("Title in this language, or null."),
            state: translationStateSchema,
            enabled: z
              .boolean()
              .describe(
                "Whether the language is enabled; translations of other languages are not shown to readers.",
              ),
          })
          .describe("The article in one language."),
      )
      .describe("The original first, then one entry per language."),
  })
  .describe("An article with its translations.");

const translationBodySchema = z
  .object({ language: languageSchema })
  .strict()
  .describe("Language of the new translation.");
const space = { type: "space", param: "spaceId" } as const;
const item = { type: "item", param: "itemId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();
const categoryParams = z.object({ itemId: uuid("ID of the category.") }).strict();
const articleParams = z.object({ itemId: uuid("ID of the article.") }).strict();

const contactSchema = z
  .string()
  .max(254)
  .nullable()
  .describe("E-mail address readers write to when an article did not help, or null.");

const settingsSchema = z
  .object({
    spaceId: uuid("ID of the knowledge base."),
    audience: audienceSchema,
    groups: z
      .array(
        z
          .object({ id: uuid("ID of the group."), name: z.string().describe("Name of the group.") })
          .describe("A group."),
      )
      .describe(
        "Groups that hold the reader role. They read the knowledge base when `audience` is `groups`.",
      ),
    contactEmail: contactSchema.describe(
      "Contact address of the knowledge base, used where no category sets its own, or null.",
    ),
  })
  .describe("Settings of a knowledge base.");

const exampleSettings = {
  spaceId: exampleSpace.id,
  audience: "signedIn" as const,
  groups: [],
  contactEmail: "help@example.org",
};

const audienceChangeSchema = z
  .object({
    audience: audienceSchema,
    groupIds: z
      .array(uuid("ID of a group."))
      .max(MAX_AUDIENCE_GROUPS)
      .default([])
      .describe("Groups that may read the knowledge base when `audience` is `groups`. Ignored otherwise."),
  })
  .strict();

const audienceBodySchema = audienceChangeSchema
  .extend({
    confirmWidening: z
      .boolean()
      .default(false)
      .describe(
        "Confirms a change that lets more people read the knowledge base. Without it such a change is refused.",
      ),
  })
  .strict()
  .describe("The new audience.");

const audienceImpactSchema = z
  .object({
    widening: z.boolean().describe("Whether more people could read the knowledge base after the change."),
    articles: z
      .number()
      .int()
      .describe(
        "Number of articles without a view restriction that the new readers could open. 0 when nothing widens.",
      ),
  })
  .describe("What the change of the audience means.");

const categorySchema = z
  .object({
    id: uuid("ID of the category, a folder in the knowledge base."),
    parentId: uuid("Parent category, or null for a top-level category.").nullable(),
    level: z.number().int().describe("1 for a category, 2 for a subcategory."),
    title: z.string().describe("Title of the category."),
    description: z.string().describe("Short introduction text."),
    icon: z.string().nullable().describe("Name of a Lucide icon, or null."),
    contactEmail: contactSchema.describe("Contact address set on the category itself, or null."),
    effectiveContactEmail: contactSchema.describe(
      "Contact address that applies: of the category, else of its parent category, else of the knowledge base.",
    ),
    contactSource: z
      .enum(["category", "parentCategory", "knowledgeBase"])
      .nullable()
      .describe("Where the contact address that applies comes from, or null when none is set."),
    position: z.string().describe("Sort key among the siblings. Categories sort by it in binary order."),
    articles: z
      .number()
      .int()
      .describe("Number of articles in the category and below that the caller can read."),
  })
  .describe("A category of a knowledge base.");

const exampleCategory = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a60",
  parentId: null,
  level: 1,
  title: "IT",
  description: "Devices, accounts and network",
  icon: "monitor",
  contactEmail: "it@example.org",
  effectiveContactEmail: "it@example.org",
  contactSource: "category" as const,
  position: "a0",
  articles: 12,
};

const categoryUpdateSchema = z
  .object({
    icon: z
      .string()
      .max(60)
      .nullable()
      .optional()
      .describe("Name of a Lucide icon such as `monitor`, or null to show the initial instead."),
  })
  .strict()
  .describe("The changes.");

const contactBodySchema = z.object({ contactEmail: contactSchema }).strict().describe("The contact address.");

const categoryReferenceSchema = z
  .object({ id: uuid("ID of the category."), title: z.string().describe("Title of the category.") })
  .describe("A category.");

const articleSummaryShape = {
  id: uuid("ID of the article."),
  spaceId: uuid("ID of the knowledge base."),
  title: z.string().describe("Title of the article."),
  type: articleTypeSchema.nullable().describe("Type of the article, or null."),
  number: z
    .number()
    .int()
    .nullable()
    .describe(
      "Number of the article, unique in its knowledge base and never reused. It stays when the article moves.",
    ),
  slug: z
    .string()
    .describe("Short form of the title for addresses. The address of an article is `<number>-<slug>`."),
  categoryPath: z
    .array(categoryReferenceSchema)
    .describe(
      "Category and subcategory of the article, as far as the caller can see them. Empty at the top level.",
    ),
  ownerId: uuid("Owner of the article, or null.").nullable(),
  ownerName: z.string().nullable().describe("Name of the owner, or null when the caller may not see it."),
  published: z
    .boolean()
    .describe("Whether the article was published. Only editors see unpublished articles."),
  contentUpdatedAt: timestamp("When the content last changed."),
  language: languageSchema.describe("Language of the article."),
  translationOf: uuid("The original article when this is a translation, or null.").nullable(),
  translations: z
    .array(
      z
        .object({
          language: languageSchema,
          itemId: uuid("ID of the translation."),
          state: translationStateSchema,
        })
        .describe("A translation of the article."),
    )
    .describe("Translations of an original article the caller can read. Empty for translations."),
};

const articleSummarySchema = z.object(articleSummaryShape).describe("An article.");

export const exampleArticle = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a61",
  spaceId: exampleSpace.id,
  title: "Set up the VPN connection",
  type: "howTo" as const,
  number: 123,
  slug: "set-up-the-vpn-connection",
  categoryPath: [{ id: exampleCategory.id, title: "IT" }],
  ownerId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  ownerName: "Anna Weber",
  published: true,
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
  language: "de",
  translationOf: null,
  translations: [
    { language: "en", itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a62", state: "outdated" as const },
  ],
};

export const articleSchema = z
  .object({
    ...articleSummaryShape,
    spaceKey: z.string().describe("Key of the knowledge base."),
    lead: z.string().describe("Short introduction below the title."),
    templateId: z.string().nullable().describe("Template the article was created from, or null."),
    contactEmail: contactSchema.describe("Contact address that applies to the article, or null."),
    version: z
      .number()
      .int()
      .nullable()
      .describe(
        "Number of the published version that is returned, or null for a draft or an unpublished article.",
      ),
    sections: z
      .array(
        z
          .object({
            key: z
              .string()
              .describe(
                "Key of the section, such as `steps` or `cause`. It keeps its meaning in every language.",
              ),
            title: z.string().describe("Heading of the section."),
            icon: z.string().nullable().describe("Name of a Lucide icon, or null."),
            text: z.string().describe("Plain text of the section."),
            html: z
              .string()
              .describe(
                "Content of the section as HTML. Images point to their display version in the API, links to other articles to the portal.",
              ),
            content: z.array(z.json()).describe("Content of the section as ProseMirror JSON nodes."),
          })
          .describe("A section of the article."),
      )
      .describe(
        "Semantic sections of the article in document order. Empty for an article written without sections.",
      ),
    document: documentSchema
      .nullable()
      .describe("Whole content as ProseMirror JSON, or null for an article that was never published."),
    images: z
      .array(
        z
          .object({
            attachmentId: uuid("ID of the image file."),
            name: z.string().describe("File name."),
            alt: z.string().describe("Alternative text, empty when the author gave none."),
            url: z
              .string()
              .describe("Address of the display version in the API; send the same token to fetch it."),
          })
          .describe("An image of the article."),
      )
      .describe("Images in the content, in document order."),
    draft: z.boolean().describe("Whether this is the current draft instead of the published version."),
    publishedAt: timestamp("When the article was published for the first time, or null.").nullable(),
    versionPublishedAt: timestamp("When the returned version was published, or null for a draft.").nullable(),
    lastReviewedAt: timestamp(
      "When the article was last reviewed while a review interval applies, or null.",
    ).nullable(),
    portalUrl: z
      .string()
      .nullable()
      .describe("Address of the article in the portal, in its language, or null when it is not published."),
  })
  .describe("An article with its sections, readable by programs.");

export const exampleArticleRecord = {
  ...exampleArticle,
  spaceKey: "HELP",
  lead: "Work from home with the company network.",
  templateId: "builtin:article-how-to",
  contactEmail: "it@example.org",
  version: 3,
  sections: [
    {
      key: "steps",
      title: "Steps",
      icon: "list-ordered",
      text: "Open the VPN client.",
      html: "<p>Open the VPN client.</p>",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Open the VPN client." }] }],
    },
  ],
  document: null,
  images: [],
  draft: false,
  publishedAt: "2026-09-01T08:00:00.000Z",
  versionPublishedAt: "2026-10-05T08:00:00.000Z",
  lastReviewedAt: null,
  portalUrl: "https://wiki.example.org/help/help/123-set-up-the-vpn-connection",
};

const articlesQuery = z
  .object({
    ...pageQuery,
    categoryId: uuid("Only articles in this category and its subcategories.").optional(),
    topLevel: z
      .enum(["true", "false"])
      .optional()
      .describe("`true` lists only articles outside every category."),
    type: z
      .enum(["howTo", "troubleshooting", "none"])
      .optional()
      .describe("Only articles of this type; `none` for articles without a type."),
  })
  .strict();

const articleQuery = z
  .object({
    draft: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "`true` returns the current draft instead of the published version. Only for editors of the article.",
      ),
  })
  .strict();

const typeBodySchema = z
  .object({ type: articleTypeSchema.nullable().describe("The new type, or null for none.") })
  .strict()
  .describe("The article type.");

const templateSectionsSchema = z
  .array(
    z
      .object({
        templateId: z.string().describe("ID of the template."),
        name: z.string().describe("Name of the template."),
        articleType: articleTypeSchema.nullable().describe("Type the template gives its articles, or null."),
        builtIn: z.boolean().describe("Whether the template ships with Pagehall."),
        sections: z
          .array(
            z
              .object({
                key: z.string().describe("Key of the section."),
                title: z.string().describe("Heading of the section."),
                icon: z.string().nullable().describe("Name of a Lucide icon, or null."),
                required: z
                  .boolean()
                  .describe(
                    "Whether articles from this template can only be published with text in this section.",
                  ),
              })
              .describe("A section of the template."),
          )
          .describe("Sections of the template in order."),
      })
      .describe("An article template of the knowledge base."),
  )
  .describe("Article templates of the knowledge base.");

const exampleTemplates = [
  {
    templateId: "builtin:article-how-to",
    name: "How-to",
    articleType: "howTo" as const,
    builtIn: true,
    sections: [{ key: "steps", title: "Steps", icon: "list-ordered", required: true }],
  },
];

const requiredBodySchema = z
  .object({
    templateId: z.string().max(100).describe("ID of the template."),
    sectionKey: z.string().max(40).describe("Key of the section."),
    required: z.boolean().describe("Whether the section must contain text before an article is published."),
  })
  .strict()
  .describe("Whether a section is required.");

@Controller("api/v1")
export class KnowledgeBasesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/knowledge-base")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Get the settings of a knowledge base",
    description: "Returns who may read the knowledge base and its contact address.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The settings.", schema: settingsSchema, example: exampleSettings },
    errors: ["notKnowledgeBase"],
  })
  async settings(@Param("spaceId") spaceId: string) {
    return this.#services.knowledgeBases.settings(spaceId);
  }

  @Post("spaces/:spaceId/knowledge-base/audience/preview")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Preview a change of the audience",
    description:
      "Says whether the change lets more people read the knowledge base and how many articles they could open. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: audienceChangeSchema.describe("The new audience."),
    bodyExample: { audience: "public", groupIds: [] },
    response: {
      description: "The impact.",
      schema: audienceImpactSchema,
      example: { widening: true, articles: 140 },
    },
    errors: ["notKnowledgeBase"],
  })
  async previewAudience(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof audienceChangeSchema>,
  ) {
    return this.#services.knowledgeBases.audienceImpact(spaceId, body);
  }

  @Put("spaces/:spaceId/knowledge-base/audience")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change who may read a knowledge base",
    description:
      "Sets the audience. With `groups`, the listed groups get the reader role and groups that are no longer listed lose it; groups with a higher role keep it. A change that lets more people read needs `confirmWidening`. Every change is audited.",
    tags: [TAG],
    params: spaceParams,
    body: audienceBodySchema,
    bodyExample: { audience: "signedIn", groupIds: [], confirmWidening: true },
    response: {
      description: "The settings after the change.",
      schema: settingsSchema,
      example: exampleSettings,
    },
    errors: [
      "notKnowledgeBase",
      "audienceWidening",
      "audienceGroupsMissing",
      "tooManyGroups",
      "invalidHolder",
      "selfExtension",
    ],
  })
  async changeAudience(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof audienceBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.knowledgeBases.changeAudience(actorOf(request), spaceId, body);
  }

  @Put("spaces/:spaceId/knowledge-base/contact")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Set the contact address of a knowledge base",
    description:
      "Sets the address used for articles whose categories have none. Pagehall sends nothing itself.",
    tags: [TAG],
    params: spaceParams,
    body: contactBodySchema,
    bodyExample: { contactEmail: "help@example.org" },
    response: {
      description: "The settings after the change.",
      schema: settingsSchema,
      example: exampleSettings,
    },
    errors: ["notKnowledgeBase", "invalidContactEmail"],
  })
  async setContact(@Param("spaceId") spaceId: string, @Body() body: z.output<typeof contactBodySchema>) {
    return this.#services.knowledgeBases.setContactEmail(spaceId, body.contactEmail);
  }

  @Get("spaces/:spaceId/categories")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the categories of a knowledge base",
    description:
      "Lists the folders on the first two levels of the knowledge base, which are its categories and subcategories, in tree order. Deeper folders belong to their subcategory.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "Categories the caller can read.",
      schema: z.array(categorySchema).describe("Categories, top level first."),
      example: [exampleCategory],
    },
    errors: ["notKnowledgeBase"],
  })
  async categories(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.knowledgeBases.categories(actorOf(request), spaceId);
  }

  @Put("categories/:itemId")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Change a category",
    description:
      "Sets the icon of a category. Title, introduction text and order change like for every folder; the contact address has its own route for space admins.",
    tags: [TAG],
    params: categoryParams,
    body: categoryUpdateSchema,
    bodyExample: { icon: "monitor" },
    status: 204,
    errors: ["notCategory", "invalidIcon"],
  })
  async updateCategory(@Param("itemId") itemId: string, @Body() body: z.output<typeof categoryUpdateSchema>) {
    await this.#services.knowledgeBases.updateCategory(itemId, { icon: body.icon });
  }

  @Put("categories/:itemId/contact")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Set the contact address of a category",
    description:
      "Sets the address readers write to from articles of the category and its subcategories, or null to inherit it. Only space admins of the knowledge base can change it.",
    tags: [TAG],
    params: categoryParams,
    body: contactBodySchema,
    bodyExample: { contactEmail: "it@example.org" },
    status: 204,
    errors: ["notCategory", "invalidContactEmail"],
  })
  async setCategoryContact(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof contactBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    const spaceId = await this.#services.knowledgeBases.categorySpace(itemId);
    await this.#services.authorization.require(actorOf(request), "space.manage", {
      type: "space",
      id: spaceId,
    });
    await this.#services.knowledgeBases.updateCategory(itemId, { contactEmail: body.contactEmail });
  }

  @Get("spaces/:spaceId/articles")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the articles of a knowledge base",
    description: "Lists the articles the caller can read, most recently changed first.",
    tags: [TAG],
    params: spaceParams,
    query: articlesQuery,
    response: {
      description: "Articles.",
      schema: pageSchema(articleSummarySchema, "Articles, most recently changed first."),
      example: { items: [exampleArticle], nextCursor: null },
    },
    errors: ["notKnowledgeBase"],
  })
  async articles(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof articlesQuery>,
    @Req() request: FastifyRequest,
  ) {
    return toApiPage(
      await this.#services.knowledgeBases.articles(actorOf(request), spaceId, {
        categoryId: query.topLevel === "true" ? null : query.categoryId,
        type: query.type,
        page: pageRequest(query, nameCursor),
      }),
    );
  }

  @Get("articles/:itemId")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Get an article with its sections",
    description:
      "Returns the published version of an article with its number, address, categories and semantic sections, for programs such as chatbots and migration scripts.",
    tags: [TAG],
    params: articleParams,
    query: articleQuery,
    response: { description: "The article.", schema: articleSchema, example: exampleArticleRecord },
    errors: ["draftNotVisible"],
  })
  async article(
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof articleQuery>,
    @Req() request: FastifyRequest,
  ) {
    const found = await this.#services.articleApi.record(actorOf(request), itemId, {
      draft: query.draft === "true",
      origin: await originOf(this.context, request),
    });
    if (!found) throw notFound();
    return found;
  }

  @Put("articles/:itemId/type")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Change the type of an article",
    description: "Sets the type that readers can filter by, or removes it.",
    tags: [TAG],
    params: articleParams,
    body: typeBodySchema,
    bodyExample: { type: "troubleshooting" },
    status: 204,
    errors: ["invalidArticleType"],
  })
  async setType(@Param("itemId") itemId: string, @Body() body: z.output<typeof typeBodySchema>) {
    await this.#services.knowledgeBases.setArticleType(itemId, body.type);
  }

  @Get("spaces/:spaceId/knowledge-base/languages")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Get the languages of a knowledge base",
    description: "Returns the default language, the enabled languages and how far the translations are.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The languages.", schema: languagesSchema, example: exampleLanguages },
    errors: ["notKnowledgeBase"],
  })
  async languages(@Param("spaceId") spaceId: string) {
    return this.#services.translations.settings(spaceId);
  }

  @Put("spaces/:spaceId/knowledge-base/languages")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the languages of a knowledge base",
    description:
      "Sets the default language and the enabled languages. Turning a language off keeps its translations but hides them from readers. A language that already has translations cannot become the default language. Audited.",
    tags: [TAG],
    params: spaceParams,
    body: languagesBodySchema,
    bodyExample: { languages: ["de", "en"] },
    response: {
      description: "The languages after the change.",
      schema: languagesSchema,
      example: exampleLanguages,
    },
    errors: ["notKnowledgeBase", "invalidLanguage", "tooManyLanguages", "defaultLanguageTranslated"],
  })
  async setLanguages(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof languagesBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.translations.update(actorOf(request), spaceId, body);
  }

  @Get("articles/:itemId/translations")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "List the translations of an article",
    description:
      "Returns the original article and one entry per enabled language, with the state of each translation. Translations the caller cannot read are listed as missing.",
    tags: [TAG],
    params: articleParams,
    response: {
      description: "The translations.",
      schema: translationsSchema,
      example: {
        sourceId: exampleArticle.id,
        spaceId: exampleSpace.id,
        defaultLanguage: "de",
        language: "de",
        translations: [
          {
            language: "de",
            itemId: exampleArticle.id,
            title: "VPN einrichten",
            state: "original" as const,
            enabled: true,
          },
          { language: "en", itemId: null, title: null, state: "missing" as const, enabled: true },
        ],
      },
    },
    errors: [],
  })
  async translations(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    const found = await this.#services.translations.translations(actorOf(request), itemId);
    if (!found) throw notFound();
    return found;
  }

  @Post("articles/:itemId/translations")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Add a translation of an article",
    description:
      "Creates the translation as a new article below the original, in the same category, with a copy of the original's content to translate. It shares the number of the original and gets its own address from its title.",
    tags: [TAG],
    status: 201,
    params: articleParams,
    body: translationBodySchema,
    bodyExample: { language: "en" },
    response: { description: "The new translation.", schema: treeItemSchema, example: exampleItem },
    errors: ["invalidLanguage", "languageNotEnabled", "translationExists", "translationSource"],
  })
  async addTranslation(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof translationBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.translations.create(actorOf(request), itemId, body.language);
  }

  @Get("spaces/:spaceId/knowledge-base/templates")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the article templates with their sections",
    description:
      "Lists the templates articles of the knowledge base can start from, with the sections that are required.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The templates.", schema: templateSectionsSchema, example: exampleTemplates },
    errors: ["notKnowledgeBase"],
  })
  async templates(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.knowledgeBases.templateSections(actorOf(request), spaceId);
  }

  @Put("spaces/:spaceId/knowledge-base/required-sections")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Make a template section required or optional",
    description:
      "A required section must contain text, an image or other content before an article from this template can be published. Published articles stay published. By default nothing is required.",
    tags: [TAG],
    params: spaceParams,
    body: requiredBodySchema,
    bodyExample: { templateId: "builtin:article-how-to", sectionKey: "steps", required: true },
    response: {
      description: "The templates after the change.",
      schema: templateSectionsSchema,
      example: exampleTemplates,
    },
    errors: ["notKnowledgeBase", "sectionNotFound"],
  })
  async setRequired(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof requiredBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.knowledgeBases.setRequired(
      actorOf(request),
      spaceId,
      body.templateId,
      body.sectionKey,
      body.required,
    );
  }
}
