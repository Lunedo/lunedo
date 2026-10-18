import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import { VERSION_NOTE_MAX_LENGTH, versionReasons } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";
import {
  copiedFromSchema,
  documentSchema,
  exampleDocument,
  modeSchema,
  pageContentSchema,
} from "./schemas.js";

const TAG = "Versions";
const page = { type: "item", param: "pageId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const versionParams = pageParams.extend({
  number: z.coerce.number().int().min(1).max(2_147_483_647).describe("Number of the version."),
});
const discardedParams = pageParams.extend({ draftId: uuid("ID of the discarded draft.") });

const referencesSchema = pageContentSchema.shape.references;

const personSchema = z
  .object({
    id: uuid("ID of the account."),
    name: z.string().nullable().describe("Name of the person, or null when the account no longer exists."),
  })
  .describe("A person.");

const versionSchema = z
  .object({
    number: z.number().int().describe("Number of the version, counting from 1."),
    title: z.string().describe("Title of the page in this version."),
    note: z.string().describe("Note of the person who published it, or empty."),
    reason: extensibleEnum(
      versionReasons,
      "Why the version exists: `published` (someone published), `session` (an editing session in live mode ended), `restored` (an older version was restored in live mode), `modeChanged` (the page switched modes), `imported` (a re-import applied the source version), `importedNotApplied` (a re-import added the source version to the history without applying it) or `copied` (the page was created as a copy of `copiedFrom`).",
    ),
    restoredFrom: z.number().int().nullable().describe("The restored version, or null."),
    copiedFrom: copiedFromSchema,
    createdAt: timestamp("When the version was created."),
    createdBy: personSchema
      .nullable()
      .describe("Who published or restored, or null for versions of live sessions."),
    contributors: z
      .array(personSchema)
      .describe("Everyone who changed the content since the previous version."),
  })
  .describe("A version of a page.");

const exampleVersion = {
  number: 7,
  title: "VPN access for remote staff",
  note: "Added the section on lost devices",
  reason: "published",
  restoredFrom: null,
  copiedFrom: null,
  createdAt: "2026-10-03T14:20:00.000Z",
  createdBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
  contributors: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" }],
};

const versionContentSchema = versionSchema
  .extend({ document: documentSchema, references: referencesSchema })
  .describe("A version with its content.");

const draftSchema = z
  .object({
    title: z.string().describe("Title of the draft."),
    document: documentSchema,
    revision: z.number().int().describe("Number of the stored state of the draft."),
    updatedAt: timestamp("When the draft was last stored."),
    hasChanges: z.boolean().describe("Whether the draft differs from the published version."),
    changes: z
      .number()
      .int()
      .nullable()
      .describe("Number of changes since the published version, or null when the page was never published."),
    basedOn: z.number().int().nullable().describe("The published version, or null."),
    contributors: z.array(personSchema).describe("Everyone who changed the draft since the last version."),
    references: referencesSchema,
  })
  .describe("The shared draft of a page.");

const exampleDraft = {
  title: "VPN access for remote staff",
  document: exampleDocument,
  revision: 18,
  updatedAt: "2026-10-07T09:12:00.000Z",
  hasChanges: true,
  changes: 3,
  basedOn: 7,
  contributors: [{ id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" }],
  references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
};

const publishSchema = z
  .object({
    note: z
      .string()
      .max(VERSION_NOTE_MAX_LENGTH * 2)
      .optional()
      .describe(`Short note on what changed, up to ${VERSION_NOTE_MAX_LENGTH} characters.`),
  })
  .strict()
  .describe("Publication of the draft.");

const publishResultSchema = z
  .object({
    version: z.number().int().describe("The version readers see now."),
    created: z
      .boolean()
      .describe(
        "Whether a new version was created. False when the draft had no changes, for example because someone else published it a moment before.",
      ),
  })
  .describe("The result of publishing.");

const modeChangeSchema = z
  .object({
    mode: modeSchema,
    confirmDraft: z
      .boolean()
      .optional()
      .describe(
        "Needed when switching to live mode while the draft has unpublished changes: they become visible to readers at once.",
      ),
  })
  .strict()
  .describe("The new editing mode.");

const discardedSchema = z
  .object({
    id: uuid("ID of the discarded draft."),
    title: z.string().describe("Title of the draft."),
    reason: z
      .enum(["discarded", "replaced"])
      .describe("`discarded` by someone, or `replaced` when an older version was restored as the draft."),
    discardedAt: timestamp("When the draft was discarded."),
    discardedBy: personSchema.nullable().describe("Who discarded it."),
    expiresAt: timestamp("Until when it can be restored."),
    contributors: z.array(personSchema).describe("Everyone who had changed the draft."),
  })
  .describe("A discarded draft that can be restored for 30 days.");

const compareQuery = z
  .object({
    from: z
      .union([z.literal("draft"), z.coerce.number().int().min(1)])
      .describe("Older side: a version number or `draft`. The draft needs edit permission."),
    to: z
      .union([z.literal("draft"), z.coerce.number().int().min(1)])
      .describe("Newer side: a version number or `draft`. The draft needs edit permission."),
  })
  .strict();

const compareSchema = z
  .object({
    diff: z
      .json()
      .describe(
        "The comparison: `title` (before and after, or null), `blocks` (each with `change` of `unchanged`, `added`, `removed`, `changed` or `moved`, the `before` and `after` nodes, changed `attributes`, and for changed blocks `inline` segments, code `lines` or `children`) and the number of `changes`.",
      ),
    before: documentSchema,
    after: documentSchema,
    references: referencesSchema,
  })
  .describe("A comparison of two versions.");

@Controller("api/v1/pages")
export class VersionsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get(":pageId/draft")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Get the draft of a page",
    description:
      "Returns the shared draft that editors work on, with the number of changes since the published version. In live mode the draft is the current content.",
    tags: [TAG],
    params: pageParams,
    response: { description: "The draft.", schema: draftSchema, example: exampleDraft },
  })
  async draft(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    const draft = await this.#services.versions.draft(pageId);
    return {
      ...draft,
      references: await this.#services.documents.references(actorOf(request), draft.document),
    };
  }

  @Post(":pageId/publish")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Publish the draft",
    description:
      "Creates a version from the draft as the server holds it now; readers see it at once. Publishing a draft without changes, also when two people publish at the same moment, creates no second version.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    body: publishSchema,
    bodyExample: { note: "Added the section on lost devices" },
    response: {
      description: "The published version.",
      schema: publishResultSchema,
      example: { version: 8, created: true },
    },
    errors: ["notPublishMode", "invalidNote"],
  })
  async publish(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof publishSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.versions.publish(actorOf(request), pageId, { note: body.note });
  }

  @Post(":pageId/draft/discard")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Discard the draft",
    description:
      "Resets the draft to the published version for everyone editing. The discarded draft can be restored for 30 days.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    response: {
      description: "The discarded draft, for undo.",
      schema: z
        .object({ discardedDraftId: uuid("ID of the discarded draft.") })
        .describe("The discarded draft."),
      example: { discardedDraftId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a50" },
    },
    errors: ["nothingToDiscard"],
  })
  async discard(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.versions.discard(actorOf(request), pageId);
  }

  @Get(":pageId/discarded-drafts")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "List discarded drafts",
    description: "Lists the drafts discarded or replaced in the last 30 days, newest first.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "Discarded drafts.",
      schema: z.array(discardedSchema).describe("Discarded drafts."),
      example: [],
    },
  })
  async discardedDrafts(@Param("pageId") pageId: string) {
    return this.#services.versions.discardedDrafts(pageId);
  }

  @Get(":pageId/discarded-drafts/:draftId")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Get a discarded draft",
    description: "Returns the content of a discarded draft.",
    tags: [TAG],
    params: discardedParams,
    response: {
      description: "The discarded draft.",
      schema: z
        .object({
          title: z.string().describe("Title of the draft."),
          document: documentSchema,
          references: referencesSchema,
        })
        .describe("A discarded draft with its content."),
      example: {
        title: exampleDraft.title,
        document: exampleDocument,
        references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
      },
    },
  })
  async discardedDraft(
    @Param("pageId") pageId: string,
    @Param("draftId") draftId: string,
    @Req() request: FastifyRequest,
  ) {
    const found = await this.#services.versions.discardedDraft(pageId, draftId);
    if (!found) throw notFound();
    return {
      ...found,
      references: await this.#services.documents.references(actorOf(request), found.document),
    };
  }

  @Post(":pageId/discarded-drafts/:draftId/restore")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Restore a discarded draft",
    description:
      "Makes a discarded draft the draft again. A current draft with changes is kept as a discarded draft itself.",
    tags: [TAG],
    params: discardedParams,
    errors: ["discardedDraftNotFound", "notPublishMode"],
  })
  async restoreDiscarded(
    @Param("pageId") pageId: string,
    @Param("draftId") draftId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.versions.restoreDiscarded(actorOf(request), pageId, draftId);
  }

  @Put(":pageId/mode")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Change the editing mode",
    description:
      "Switches between publish and live mode. Switching to publish mode makes the current content the published version. Switching to live mode with unpublished changes needs `confirmDraft`, because readers see them at once.",
    tags: [TAG],
    params: pageParams,
    body: modeChangeSchema,
    bodyExample: { mode: "live", confirmDraft: true },
    errors: ["draftPending"],
  })
  async changeMode(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof modeChangeSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.versions.changeMode(actorOf(request), pageId, body.mode, {
      confirmDraft: body.confirmDraft,
    });
  }

  @Get(":pageId/versions")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List the versions of a page",
    description:
      "Lists all versions, newest first. Versions are kept without limit. The draft is not part of this list.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "Versions.",
      schema: z.array(versionSchema).describe("Versions, newest first."),
      example: [exampleVersion],
    },
  })
  async versions(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.copies.sources(actorOf(request), await this.#services.versions.list(pageId));
  }

  @Get(":pageId/versions/:number")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Get a version",
    description: "Returns a version with its title and content.",
    tags: [TAG],
    params: versionParams,
    response: {
      description: "The version.",
      schema: versionContentSchema,
      example: {
        ...exampleVersion,
        document: exampleDocument,
        references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
      },
    },
  })
  async version(
    @Param("pageId") pageId: string,
    @Param("number") number: number,
    @Req() request: FastifyRequest,
  ) {
    const stored = await this.#services.versions.get(pageId, number);
    if (!stored) throw notFound();
    const [version] = await this.#services.copies.sources(actorOf(request), [stored]);
    if (!version) throw notFound();
    return {
      ...version,
      references: await this.#services.documents.references(actorOf(request), version.document),
    };
  }

  @Post(":pageId/versions/:number/restore")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Restore a version",
    description:
      "In publish mode the version becomes the draft, to be reviewed and published; a draft with changes is kept as a discarded draft. In live mode it becomes the current content at once and creates a new version. History is never rewritten.",
    tags: [TAG],
    status: 200,
    params: versionParams,
    response: {
      description: "What happened.",
      schema: z
        .object({
          mode: modeSchema,
          version: z
            .number()
            .int()
            .nullable()
            .describe("The new version in live mode, or null in publish mode."),
        })
        .describe("The result of restoring."),
      example: { mode: "publish", version: null },
    },
    errors: ["versionNotFound"],
  })
  async restore(
    @Param("pageId") pageId: string,
    @Param("number") number: number,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.versions.restore(actorOf(request), pageId, number);
  }

  @Get(":pageId/compare")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Compare two versions",
    description:
      "Compares two versions, or a version with the draft: text, formatting, tables, callouts, code, formulas, tasks, title and moved blocks.",
    tags: [TAG],
    params: pageParams,
    query: compareQuery,
    response: {
      description: "The comparison.",
      schema: compareSchema,
      example: {
        diff: { title: null, blocks: [], changes: 0 },
        before: exampleDocument,
        after: exampleDocument,
        references: { people: {}, pages: {}, topics: {}, tooLargeImages: [] },
      },
    },
    errors: ["versionNotFound"],
  })
  async compare(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof compareQuery>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    if (query.from === "draft" || query.to === "draft") {
      await this.#services.authorization.require(actor, "item.edit", { type: "item", id: pageId });
    }
    const result = await this.#services.versions.compare(pageId, query.from, query.to);
    const references = await this.#services.documents.references(actor, {
      type: "doc",
      content: [...(result.before.content ?? []), ...(result.after.content ?? [])],
    });
    return { ...result, references };
  }
}
