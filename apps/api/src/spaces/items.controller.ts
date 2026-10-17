import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { containsBlock, MAX_TREE_PAGE, renderPageMarkdown, treeItemKinds } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { parentEntriesSchema, restorableInSpace, withParentsQuery } from "./restore-parents.js";
import {
  archivedItemSchema,
  backlinkSchema,
  contentLanguageBodySchema,
  createItemSchema,
  documentSchema,
  exampleDocument,
  exampleItem,
  exampleMoveImpact,
  examplePageContent,
  exampleTrashEntry,
  itemDetailsSchema,
  labelsSchema,
  moveImpactSchema,
  moveItemSchema,
  pageContentSchema,
  trashEntrySchema,
  treeItemSchema,
  updateItemSchema,
} from "./schemas.js";

const TAG = "Pages";
const space = { type: "space", param: "spaceId" } as const;
const item = { type: "item", param: "itemId" } as const;
const page = { type: "item", param: "pageId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const itemParams = z.object({ itemId: uuid("ID of the page, folder or link.") }).strict();
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const labelParams = pageParams.extend({ label: z.string().max(200).describe("The label.") });
const spaceLabelParams = spaceParams.extend({ label: z.string().max(200).describe("The label.") });

const positionCursor = z.tuple([z.string().max(10_000)]);

const childrenQuery = z
  .object({
    parentId: uuid("Parent item. Leave it out for the root of the tree.").optional(),
    cursor: z.string().max(20_000).optional().describe("Cursor from `nextCursor` of the previous page."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_TREE_PAGE)
      .default(200)
      .describe(`Maximum number of items, from 1 to ${MAX_TREE_PAGE}. Default 200.`),
  })
  .strict();

const searchQuery = z
  .object({
    q: z.string().trim().max(200).default("").describe("Text the title contains."),
    spaceId: uuid("Only items of this space.").optional(),
    kind: z
      .enum(treeItemKinds)
      .optional()
      .describe("Only items of this kind. Without it, pages and folders are searched."),
    limit: z.coerce.number().int().min(1).max(50).default(20).describe("Maximum number of results, 1 to 50."),
  })
  .strict();

const labelQuery = z
  .object({ q: z.string().trim().max(100).default("").describe("Start of the label.") })
  .strict();

const convertSchema = z
  .object({ kind: z.enum(["page", "folder"]).describe("The new kind. Children are kept.") })
  .strict()
  .describe("The kind to convert to.");

const previewMoveSchema = z
  .object({
    spaceId: uuid("Target space. Leave it out to stay in the space.").optional(),
    parentId: uuid("Parent item, or null for the root of the tree.").nullable(),
  })
  .strict()
  .describe("The place the item would move to.");

const replaceSchema = z
  .object({ document: documentSchema })
  .strict()
  .describe("The new content. It must follow the editor schema.");

const labelSchema = z
  .object({
    label: z.string().max(200).describe("The label; it is stored in lowercase with dashes for spaces."),
  })
  .strict()
  .describe("A label.");

const followSchema = z
  .object({
    spaceId: uuid("Space the link points to."),
    title: z.string().max(255).describe("Title of the page the link points to."),
  })
  .strict()
  .describe("A link by title.");

const childrenSchema = z
  .object({
    items: z.array(treeItemSchema).describe("Children, in tree order."),
    nextCursor: z.string().nullable().describe("Cursor for the next page, or null on the last page."),
  })
  .describe("Children of an item or the root items of a space.");

const searchResultSchema = treeItemSchema
  .extend({
    spaceKey: z.string().describe("Key of the item's space."),
    spaceName: z.string().describe("Name of the item's space."),
  })
  .describe("A found item.");

const markdownSchema = z
  .object({
    itemId: uuid("ID of the page."),
    markdown: z.string().describe("The content as GitHub-flavored Markdown."),
    revision: z.number().int().describe("Number of the stored state."),
    updatedAt: z.iso.datetime().describe("When the content was last stored. ISO 8601 timestamp in UTC."),
  })
  .describe("The content of a page as Markdown.");

const pagesWithLabelSchema = z
  .array(
    z
      .object({
        itemId: uuid("ID of the page."),
        title: z.string().describe("Title of the page."),
        contentUpdatedAt: z.iso
          .datetime()
          .describe("When its content last changed. ISO 8601 timestamp in UTC."),
      })
      .describe("A page with the label."),
  )
  .describe("Pages with the label, ordered by title.");

const followResultSchema = z
  .object({
    itemId: uuid("The page the link leads to."),
    created: z.boolean().describe("Whether the page was created now."),
  })
  .describe("Where the link leads.");

@Controller("api/v1")
export class ItemsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces/:spaceId/items")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List items of the page tree",
    description:
      "Lists the root items of a space or the children of an item, in tree order. Children load per level, so large spaces stay fast.",
    tags: [TAG],
    params: spaceParams,
    query: childrenQuery,
    response: {
      description: "The items.",
      schema: childrenSchema,
      example: { items: [exampleItem], nextCursor: null },
    },
  })
  async children(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof childrenQuery>,
    @Req() request: FastifyRequest,
  ) {
    const after = decodeCursor(query.cursor, positionCursor);
    const result = await this.#services.tree.children(actorOf(request), spaceId, query.parentId ?? null, {
      after: after?.[0],
      limit: query.limit,
    });
    return { items: result.items, nextCursor: result.next ? encodeCursor([result.next]) : null };
  }

  @Post("spaces/:spaceId/items")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "Create a page, folder, link or whiteboard",
    description:
      "Creates an item in the page tree, at the end of its parent unless a neighbor is given. A whiteboard starts empty. Links point to a page or folder in any space the caller can read, or to an `http` or `https` address. A page can start from a template; later changes to the template do not change the page. A new page in publish mode is visible only to editors until it is published.",
    tags: [TAG],
    params: spaceParams,
    body: createItemSchema,
    bodyExample: { kind: "page", title: "VPN access for remote staff", parentId: null },
    status: 201,
    response: { description: "The new item.", schema: treeItemSchema, example: exampleItem },
    errors: [
      "invalidTitle",
      "invalidDescription",
      "invalidPlacement",
      "invalidLinkUrl",
      "invalidLinkTarget",
      "templateNotFound",
      "invalidTemplateValues",
    ],
  })
  async create(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof createItemSchema>,
    @Req() request: FastifyRequest,
  ) {
    const placement = { parentId: body.parentId, beforeId: body.beforeId, afterId: body.afterId };
    if (body.template && body.kind === "page") {
      return this.#services.templates.instantiate(actorOf(request), spaceId, {
        templateId: body.template.id,
        values: body.template.values,
        placement,
        title: body.title,
        titlePattern: body.template.titlePattern,
        mode: body.mode,
      });
    }
    return this.#services.tree.create(actorOf(request), spaceId, {
      mode: body.mode,
      kind: body.kind,
      title: body.title,
      description: body.description,
      placement: { parentId: body.parentId, beforeId: body.beforeId, afterId: body.afterId },
      link: body.link,
    });
  }

  @Get("items")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "Find pages and folders by title",
    description: "Searches the titles of items the caller can read, in all spaces or in one.",
    tags: [TAG],
    query: searchQuery,
    response: {
      description: "Found items, best matches first.",
      schema: z.array(searchResultSchema).describe("Found items."),
      example: [{ ...exampleItem, spaceKey: "ITOPS", spaceName: "IT Operations" }],
    },
  })
  async search(@Query() query: z.output<typeof searchQuery>, @Req() request: FastifyRequest) {
    return this.#services.tree.search(actorOf(request), {
      query: query.q,
      spaceId: query.spaceId,
      kinds: query.kind ? [query.kind] : undefined,
      limit: query.limit,
    });
  }

  @Get("items/:itemId")
  @Permission("item.view", item)
  @ApiRoute({
    summary: "Get an item of the page tree",
    description: "Returns a page, folder or link with its space and ancestors.",
    tags: [TAG],
    params: itemParams,
    response: {
      description: "The item.",
      schema: itemDetailsSchema,
      example: {
        ...exampleItem,
        spaceKey: "ITOPS",
        spaceName: "IT Operations",
        spaceAccess: true,
        spaceContentLanguage: "en",
        ancestors: [],
        owner: {
          id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
          name: "Anna Weber",
          email: "anna.weber@example.org",
          active: true,
        },
        ownershipTransferable: true,
      },
    },
  })
  async get(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    const found = await this.#services.tree.details(actorOf(request), itemId);
    if (!found) throw notFound();
    return found;
  }

  @Patch("items/:itemId")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Change an item",
    description: "Changes the title, the description of a folder or the width of a page.",
    tags: [TAG],
    params: itemParams,
    body: updateItemSchema,
    bodyExample: { title: "VPN access" },
    response: { description: "The changed item.", schema: treeItemSchema, example: exampleItem },
    errors: ["invalidTitle", "invalidDescription"],
  })
  async update(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof updateItemSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tree.update(actorOf(request), itemId, body);
  }

  @Post("items/:itemId/move/preview")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Preview a move",
    description:
      "Shows who would gain or lose access to the item and its children if it moved to the place, through roles in the space and through view restrictions it inherits there. When access changes, the answer carries a confirmation to send with the move. Needs edit permission in both spaces. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: itemParams,
    body: previewMoveSchema,
    bodyExample: { spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10", parentId: null },
    response: { description: "The change in access.", schema: moveImpactSchema, example: exampleMoveImpact },
    errors: ["invalidPlacement", "moveIntoDescendant", "overviewPage", "confidentialSharing"],
  })
  async previewMove(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof previewMoveSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tree.moveImpact(actorOf(request), itemId, body);
  }

  @Post("items/:itemId/move")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Move an item",
    description:
      "Moves an item with its children to another place, also in another space. Moving below the item itself or one of its descendants is refused. Moving to another space needs edit permission in both spaces. When the move changes who can access the content, through roles or inherited view restrictions, it is refused with the change unless the request carries the confirmation of a preview of exactly that change.",
    tags: [TAG],
    status: 200,
    params: itemParams,
    body: moveItemSchema,
    bodyExample: { parentId: null, afterId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a41" },
    response: { description: "The moved item.", schema: treeItemSchema, example: exampleItem },
    errors: [
      "invalidPlacement",
      "moveIntoDescendant",
      "itemMoved",
      "overviewPage",
      "confidentialSharing",
      "moveChangesAccess",
    ],
  })
  async move(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof moveItemSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tree.move(actorOf(request), itemId, body);
  }

  @Post("items/:itemId/convert")
  @Permission("item.edit", item)
  @ApiRoute({
    summary: "Convert between page and folder",
    description: "Turns a folder into a page or a page into a folder. Children stay where they are.",
    tags: [TAG],
    status: 200,
    params: itemParams,
    body: convertSchema,
    bodyExample: { kind: "folder" },
    response: {
      description: "The converted item.",
      schema: treeItemSchema,
      example: { ...exampleItem, kind: "folder" },
    },
    errors: ["invalidConversion", "overviewPage"],
  })
  async convert(
    @Param("itemId") itemId: string,
    @Body() body: z.output<typeof convertSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tree.convert(actorOf(request), itemId, body.kind);
  }

  @Get("pages/:pageId/content")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Get the content of a page",
    description:
      "Returns the content readers see as ProseMirror JSON: the published version in publish mode, the current content in live mode. With it come the names of mentioned people and the titles of linked pages the caller may see. Editors get the draft from the draft endpoint.",
    tags: [TAG],
    params: pageParams,
    response: { description: "The content.", schema: pageContentSchema, example: examplePageContent },
  })
  async content(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    const readable = await this.#services.documents.readable(pageId);
    if (!readable) throw notFound();
    return {
      ...readable,
      references: await this.#services.documents.references(actorOf(request), readable.document),
    };
  }

  @Get("pages/:pageId/markdown")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Get the content of a page as Markdown",
    description: "Returns the content readers see as GitHub-flavored Markdown.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "The content.",
      schema: markdownSchema,
      example: {
        itemId: examplePageContent.itemId,
        markdown: "Connect through WireGuard.\n",
        revision: 4,
        updatedAt: "2026-10-05T08:10:00.000Z",
      },
    },
  })
  async markdown(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    const snapshot = await this.#services.documents.readable(pageId);
    if (!snapshot) throw notFound();
    const actor = actorOf(request);
    const references = await this.#services.documents.references(actor, snapshot.document);
    const listings = {
      childPages: await this.#services.documents.childPages(actor, pageId, snapshot.document),
      attachments: containsBlock(snapshot.document, "attachmentList")
        ? (await this.#services.attachments.list(actor, pageId, "published")).map(({ id, name, size }) => ({
            id,
            name,
            size,
          }))
        : null,
      ...(await this.#services.reports.forDocument(actor, snapshot.document, pageId)),
    };
    const merged = {
      ...references,
      people: { ...listings.references.people, ...references.people },
      pages: { ...listings.references.pages, ...references.pages },
    };
    return {
      itemId: pageId,
      markdown: renderPageMarkdown(snapshot.document, merged, listings),
      revision: snapshot.revision,
      updatedAt: snapshot.updatedAt,
    };
  }

  @Put("pages/:pageId/content")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Replace the content of a page",
    description:
      "Stores new content. It must follow the editor schema. The change is merged into the collaborative document, so people editing the page see it at once. In publish mode it changes the draft; publish it to show it to readers.",
    tags: [TAG],
    params: pageParams,
    body: replaceSchema,
    bodyExample: { document: exampleDocument },
    response: { description: "The stored content.", schema: pageContentSchema, example: examplePageContent },
    errors: ["invalidDocument"],
  })
  async replace(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof replaceSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const snapshot = await this.#services.documents.replace(actor, pageId, body.document);
    const draft = await this.#services.versions.draft(pageId);
    return {
      ...snapshot,
      title: draft.title,
      version: draft.basedOn,
      references: await this.#services.documents.references(actor, snapshot.document),
    };
  }

  @Get("pages/:pageId/backlinks")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List the pages that link to a page",
    description: "Lists the pages with a link to this page, as far as the caller can read them.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "Pages that link here.",
      schema: z.array(backlinkSchema).describe("Pages, ordered by title."),
      example: [
        {
          itemId: exampleItem.id,
          title: "Onboarding new staff",
          spaceId: exampleItem.spaceId,
          spaceKey: "ITOPS",
          spaceName: "IT Operations",
        },
      ],
    },
  })
  async backlinks(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.documents.backlinks(actorOf(request), pageId);
  }

  @Post("pages/:pageId/links/follow")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Follow a link to a page by title",
    description:
      "Opens the page with the title in the space, or creates it when it does not exist yet and the caller may edit there. When the caller may edit this page, its links by title become links by ID.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    body: followSchema,
    bodyExample: { spaceId: exampleItem.spaceId, title: "Device naming" },
    response: {
      description: "The page the link leads to.",
      schema: followResultSchema,
      example: { itemId: exampleItem.id, created: true },
    },
    errors: ["invalidTitle"],
  })
  async follow(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof followSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tree.followTitleLink(actorOf(request), pageId, body);
  }

  @Put("pages/:pageId/content-language")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Set the content language of a page",
    description:
      "Sets the language search uses to match the words of the page, or clears it so the page uses the content language of its space.",
    tags: [TAG],
    params: pageParams,
    body: contentLanguageBodySchema,
    bodyExample: { language: "de" },
    response: {
      description: "The page.",
      schema: treeItemSchema,
      example: { ...exampleItem, contentLanguage: "de" },
    },
  })
  async setContentLanguage(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof contentLanguageBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tree.setContentLanguage(actorOf(request), pageId, body.language);
  }

  @Get("pages/:pageId/labels")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List the labels of a page",
    description: "Returns the labels of the page, sorted.",
    tags: [TAG],
    params: pageParams,
    response: { description: "The labels.", schema: labelsSchema, example: ["runbook", "vpn"] },
  })
  async labels(@Param("pageId") pageId: string) {
    return this.#services.documents.labels(pageId);
  }

  @Post("pages/:pageId/labels")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Add a label to a page",
    description: "Adds a label. Labels are stored in lowercase with dashes instead of spaces.",
    tags: [TAG],
    status: 200,
    params: pageParams,
    body: labelSchema,
    bodyExample: { label: "Runbook" },
    response: {
      description: "The labels after the change.",
      schema: labelsSchema,
      example: ["runbook", "vpn"],
    },
    errors: ["invalidLabel", "tooManyLabels"],
  })
  async addLabel(
    @Param("pageId") pageId: string,
    @Body() body: z.output<typeof labelSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.documents.addLabel(actorOf(request), pageId, body.label);
  }

  @Delete("pages/:pageId/labels/:label")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Remove a label from a page",
    description: "Removes the label from the page.",
    tags: [TAG],
    params: labelParams,
    response: { description: "The labels after the change.", schema: labelsSchema, example: ["vpn"] },
  })
  async removeLabel(@Param("pageId") pageId: string, @Param("label") label: string) {
    return this.#services.documents.removeLabel(pageId, label);
  }

  @Get("spaces/:spaceId/labels")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Suggest labels",
    description:
      "Suggests labels used in readable spaces of the same organization, most used first. For a personal space, labels of readable personal spaces.",
    tags: [TAG],
    params: spaceParams,
    query: labelQuery,
    response: {
      description: "Suggested labels.",
      schema: labelsSchema,
      example: ["runbook", "release-notes"],
    },
  })
  async suggestLabels(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof labelQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.documents.labelSuggestions(actorOf(request), spaceId, query.q);
  }

  @Get("spaces/:spaceId/labels/:label/pages")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the pages with a label",
    description: "Lists the pages of the space that carry the label.",
    tags: [TAG],
    params: spaceLabelParams,
    response: {
      description: "Pages with the label.",
      schema: pagesWithLabelSchema,
      example: [
        { itemId: exampleItem.id, title: exampleItem.title, contentUpdatedAt: "2026-10-05T08:10:00.000Z" },
      ],
    },
  })
  async pagesWithLabel(
    @Param("spaceId") spaceId: string,
    @Param("label") label: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.documents.pagesWithLabel(actorOf(request), spaceId, label);
  }

  @Delete("items/:itemId")
  @Permission("item.delete", item)
  @ApiRoute({
    summary: "Delete an item",
    description:
      "Moves a page, folder or link with all its descendants into the trash of the space as one entry. Restore it from the trash to undo. The overview page of a space cannot be deleted.",
    tags: [TAG],
    status: 200,
    params: itemParams,
    response: { description: "The trash entry.", schema: trashEntrySchema, example: exampleTrashEntry },
    errors: ["overviewPage"],
  })
  async delete(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    return this.#services.trash.deleteItem(actorOf(request), itemId);
  }

  @Post("items/:itemId/archive")
  @Permission("item.archive", item)
  @ApiRoute({
    summary: "Archive an item",
    description:
      "Archives a page or folder with its descendants. They become read-only, leave the page tree and appear in the archive of the space. Versions and links stay.",
    tags: [TAG],
    params: itemParams,
    errors: ["overviewPage"],
  })
  async archive(@Param("itemId") itemId: string, @Req() request: FastifyRequest) {
    await this.#services.archive.archive(actorOf(request), itemId);
  }

  @Post("items/:itemId/unarchive")
  @Permission("item.archive", item)
  @ApiRoute({
    summary: "Bring back an archived item",
    description:
      "Returns an archived page or folder with its descendants to its old place in the page tree, or to the top level when that place no longer exists. When the former parent page is in the trash and the item would lose a view restriction it inherited, the request is refused with `restrictedParentInTrash`; repeat it with `withParents=true` to restore the parent pages from the trash with it.",
    tags: [TAG],
    status: 200,
    params: itemParams,
    query: withParentsQuery,
    response: {
      description: "Where the item went.",
      schema: z
        .object({
          parentId: uuid("The new parent, or null for the top level.").nullable(),
          parentEntries: parentEntriesSchema,
        })
        .describe("The place of the item."),
      example: { parentId: null, parentEntries: 0 },
    },
    errors: ["notArchived", "restrictedParentInTrash"],
  })
  async unarchive(
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof withParentsQuery>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const item = await this.#services.tree.get(actor, itemId);
    if (!item) throw notFound();
    return this.#services.archive.unarchive(actor, itemId, {
      withParents: query.withParents === "true",
      mayRestore: restorableInSpace(this.#services, actor, item.spaceId),
    });
  }

  @Get("spaces/:spaceId/archive")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the archive of a space",
    description:
      "Lists the archived pages and folders of a space by title. Their descendants load through the list of children.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "Archived items.",
      schema: z.array(archivedItemSchema).describe("Archived items, by title."),
      example: [
        {
          id: exampleItem.id,
          kind: "page",
          title: "Printer list 2024",
          hasChildren: false,
          archivedAt: "2026-10-05T08:00:00.000Z",
          archivedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" },
        },
      ],
    },
  })
  async archived(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.archive.list(actorOf(request), spaceId);
  }
}
