import { exportFormats, exportScopes, exportStates, orientations, paperSizes } from "@pagehall/server";
import { z } from "zod";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

export const exportSchema = z
  .object({
    id: uuid("ID of the export."),
    scope: z
      .enum(exportScopes)
      .describe("What is exported: `space` for a whole space, `pages` for a page with its subpages."),
    format: z
      .enum(exportFormats)
      .describe(
        "What the file contains: `archive` a ZIP with every page as Markdown and HTML, `html` or `markdown` a ZIP with one of them, `print` one print-ready HTML file, `pdf` one PDF file, `docx` one Word document.",
      ),
    options: z
      .object({
        attachments: z.boolean().describe("Whether the attachments are included or listed."),
        comments: z.boolean().describe("Whether open comments are included."),
        contents: z.boolean().describe("Whether a table of contents is included."),
        paper: z.enum(paperSizes).describe("Paper size of `print`, `pdf` and `docx`."),
        orientation: z.enum(orientations).describe("Orientation of `print`, `pdf` and `docx`."),
      })
      .describe("The options the export was started with."),
    spaceId: uuid("The exported space, or null when it was deleted since.").nullable(),
    rootItemId: uuid("The exported page for `pages`, or null.").nullable(),
    name: z.string().describe("Name of the space or title of the page when the export was started."),
    state: z
      .enum(exportStates)
      .describe(
        "`queued` waits for a worker, `running` is being built, `ready` can be downloaded, `failed` stopped with an error.",
      ),
    progress: z
      .object({
        done: z.number().int().describe("Files written so far."),
        total: z.number().int().describe("Files in the export, 0 until known."),
      })
      .describe("Progress of a running export."),
    fileName: z.string().nullable().describe("File name of the file once it is ready."),
    size: z.number().int().nullable().describe("Size of the file in bytes once it is ready."),
    errorCode: extensibleEnum(
      [
        "exportDisabled",
        "noAccess",
        "tokenRevoked",
        "notEnoughStorage",
        "renderUnavailable",
        "renderFailed",
        "renderTooLarge",
        "interrupted",
        "internalError",
      ],
      "Why a failed export stopped: export was turned off for the space, the permission to export the space or page was lost, the API token that started it was revoked, the file store ran short of free space while it was written, the render container for PDF is not set up or cannot be reached, it could not create the PDF, the document was larger than the render container accepts, the worker was interrupted too often, or an unexpected error.",
    ).nullable(),
    createdAt: timestamp("When the export was started."),
    finishedAt: timestamp("When the export finished or failed.").nullable(),
    expiresAt: timestamp(
      "When the download is deleted: 24 hours after its first complete download, at the latest 7 days after it is ready.",
    ).nullable(),
  })
  .describe("An export of a space or of a page with its subpages, built in the background.");

export const exampleExport = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a90",
  scope: "space",
  format: "archive",
  options: { attachments: true, comments: false, contents: true, paper: "a4", orientation: "portrait" },
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  rootItemId: null,
  name: "IT Operations",
  state: "ready",
  progress: { done: 413, total: 413 },
  fileName: "IT Operations 2026-10-14.zip",
  size: 18_432_112,
  errorCode: null,
  createdAt: "2026-10-14T09:00:00.000Z",
  finishedAt: "2026-10-14T09:01:12.000Z",
  expiresAt: "2026-10-21T09:01:12.000Z",
};

export const exportCountsSchema = z
  .object({
    pages: z.number().int().describe("Pages you can read in the scope."),
    blogPosts: z.number().int().describe("Published blog posts you can read; only for a whole space."),
    printLimit: z.number().int().describe("Most pages a browser prints at once through the print view."),
    serverPdf: z
      .boolean()
      .describe("Whether the render container is set up, so PDF can be created on the server."),
  })
  .describe("What an export of a space or of a page with its subpages contains.");

export const exampleExportCounts = {
  pages: 412,
  blogPosts: 31,
  printLimit: 300,
  serverPdf: false,
};
